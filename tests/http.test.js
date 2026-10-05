import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { server } from '../proxy/server.js';

/**
 * Drives real HTTP requests at the real server instance — the gap that let
 * a single malformed request (`GET //:`) crash the whole process, exposed
 * on every interface, with /state readable cross-origin. `server` is
 * imported, never started automatically (the `isMain` guard in
 * proxy/server.js only listens when the file is run directly), so this file
 * owns the listen/close lifecycle on an OS-assigned ephemeral port.
 */
let port;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
});

after(() => new Promise(resolve => server.close(resolve)));

function request(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString()
      }));
    }).on('error', reject);
  });
}

test('a malformed request target (invalid to the WHATWG URL parser) gets 400, not a dead process', async () => {
  const bad = await request('//:');
  assert.ok(bad.status >= 400 && bad.status < 500, `expected a 4xx, got ${bad.status}`);

  // The property that actually matters: the process is still alive and
  // serving afterward. Before the fix this request killed it outright —
  // every subsequent request would fail to even connect.
  const next = await request('/state');
  assert.equal(next.status, 200, 'the server must survive a malformed request');
});

test('a directory under overlay/ is a 404, not a crash', async () => {
  const res = await request('/logo');
  assert.equal(res.status, 404);

  const next = await request('/state');
  assert.equal(next.status, 200, 'the server must survive a directory request');
});

test('/state carries no access-control-allow-origin — the overlay is same-origin and no one else should read it', async () => {
  const res = await request('/state');
  assert.equal(res.status, 200);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('traversal attempts still 404 over the real HTTP path, not just against the unit-tested resolver', async () => {
  for (const attack of ['/../package.json', '/%2e%2e%2fpackage.json', '/....//....//package.json']) {
    const res = await request(attack);
    assert.equal(res.status, 404, `${attack} must not escape overlay/`);
  }
});

test('a normal static asset and /fixture still work', async () => {
  const index = await request('/');
  assert.equal(index.status, 200);
  assert.match(index.headers['content-type'], /html/);

  const fixture = await request('/fixture');
  assert.equal(fixture.status, 200);
  const doc = JSON.parse(fixture.body);
  assert.ok('operator' in doc, 'the document always carries the operator slot');
  assert.ok('session' in doc, 'and the session block');
});

test('overlay code is served no-store, so an edit is never masked by a cache', async () => {
  // A response with no freshness information is left to the browser's
  // heuristics, and OBS's Chromium will reuse it — which presents as "my
  // change did not work" long after the proxy has been restarted.
  for (const path of ['/', '/app.js', '/overlay.css', '/tokens.css']) {
    const res = await request(path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers['cache-control'], 'no-store', path);
  }
});

test('vendored binaries stay cacheable, so reloads do not flash the fallback font', async () => {
  const res = await request('/fonts/radiance-bold.otf');
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'] ?? '', /max-age=\d+/);
});

test('hero icons are served as webp, not as a generic byte stream', async () => {
  const res = await request('/heroes/20.webp');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/webp');
});

/**
 * DNS rebinding. Loopback binding keeps the network out but not a browser on
 * this machine: a page can resolve a name it owns to 127.0.0.1 and then fetch
 * /state same-origin, which CORS does not stop — after the rebind the browser
 * does not consider it cross-origin. The reply carries the operator's account
 * id, persona, rank and live-match status.
 *
 * The Host header is the one thing that still names the rebound hostname, so
 * these pin both directions: a forged host is refused, and the hosts OBS and a
 * developer actually use keep working.
 */
function requestWithHost(path, host) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path, headers: { host } }, res => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    }).on('error', reject);
  });
}

test('a forged Host is refused, so a rebound name cannot read /state', async () => {
  for (const host of ['evil.example.com', 'attacker.test:7331', 'dsn.localtest.me:7331',
                      'localhost.evil.com:7331', '127.0.0.1.evil.com']) {
    const res = await requestWithHost('/state', host);
    assert.equal(res.status, 403, `${host} must not reach /state`);
  }
});

test('the hosts OBS and development actually use still work', async () => {
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`,
                      'localhost', '127.0.0.1']) {
    const res = await requestWithHost('/state', host);
    assert.equal(res.status, 200, `${host} is a real local host and must be served`);
  }
});

test('a request with no Host at all is refused rather than defaulting to allowed', async () => {
  // Written on a raw socket because Node's HTTP client substitutes a default
  // Host when you try to omit it — the first version of this test was checking
  // the client, not the server. HTTP/1.1 requires Host, so its absence is
  // already malformed; the point is that the check fails closed rather than
  // treating undefined as local.
  const status = await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      const CRLF = String.fromCharCode(13, 10);
      socket.write(['GET /state HTTP/1.1', 'Connection: close', '', ''].join(CRLF));
    });
    let buf = '';
    socket.on('data', c => { buf += c; });
    socket.on('end', () => resolve(Number(buf.split(' ')[1])));
    socket.on('error', reject);
  });
  // 400, not 403: Node's own HTTP server rejects a Host-less HTTP/1.1 request
  // before any handler runs. That is a stricter outcome than the allowlist
  // would give, so what is asserted is that the request is refused — pinning
  // 403 here would pin Node's internals instead of this project's behaviour.
  assert.ok(status === 400 || status === 403,
    `a request with no Host must be refused, got ${status}`);
  assert.notEqual(status, 200, 'it must never be served');
});
