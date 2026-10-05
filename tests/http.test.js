import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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
  assert.equal(doc.teams.length, 2);
});
