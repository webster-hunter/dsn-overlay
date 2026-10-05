import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, normalize, sep } from 'node:path';
// The REAL resolver, not a copy. A hand-duplicated one could diverge from the
// route silently, which would defeat the purpose of this entire test file.
import { resolveStatic as resolveFile } from '../proxy/static.js';

/** Mirror the server's URL parsing, then hand off to the real resolver. */
function resolveStatic(rawUrl) {
  const url = new URL(rawUrl, 'http://localhost:7331');
  return resolveFile(url.pathname);
}

const ROOT = resolve('overlay');

test('every traversal attempt stays inside overlay/', () => {
  const attacks = [
    '/../package.json',
    '/../../../../../../Windows/win.ini',
    '/%2e%2e%2fpackage.json',
    '/%2e%2e/%2e%2e/package.json',
    '/..%2f..%2fpackage.json',
    '/%252e%252e%252fpackage.json',
    '/....//....//package.json',
    '/../.git/config',
    '/%00/../package.json',
    '/a/b/../../../package.json',
    '//package.json',
    '/\\..\\..\\package.json'
  ];
  for (const attack of attacks) {
    const abs = resolve(resolveStatic(attack));
    assert.ok(abs.startsWith(ROOT),
      `${attack} escaped the overlay root -> ${abs}`);
  }
});

test('mapLimited bounds concurrency and isolates per-item failures', async () => {
  // mapLimited is what keeps the 18.5MB match assembly from arriving at once
  // and what stops one failing history losing the other eleven. It had no test
  // of either property; this task is its first caller, so it gets one here.
  const { mapLimited } = await import('../proxy/deadlock.js');

  let inFlight = 0, peak = 0;
  const ids = Array.from({ length: 12 }, (_, i) => i + 1);

  const out = await mapLimited(ids, async id => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    if (id === 5) throw new Error('simulated upstream failure');
    return `ok-${id}`;
  }, 3);

  assert.ok(peak <= 3, `concurrency exceeded the limit: peaked at ${peak}`);
  assert.equal(out.size, 12, 'every id must appear in the result');
  assert.equal(out.get(5), null, 'the failing id maps to null');
  assert.equal([...out.values()].filter(v => v !== null).length, 11,
    'one failure must not lose the other eleven');
});

test('mapLimited never spawns more workers than it has items', async () => {
  const { mapLimited } = await import('../proxy/deadlock.js');
  let peak = 0, inFlight = 0;
  const out = await mapLimited([1, 2], async id => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--; return id;
  }, 10);
  assert.equal(out.size, 2);
  assert.ok(peak <= 2, `spawned ${peak} workers for 2 items`);
});

test('an unset account id must never be sent to the active-match filter', async () => {
  // /v1/matches/active ignores a falsy account_id and returns the whole
  // 150-match watch list, so an unguarded poll would render a stranger's game.
  const { activeMatchFor } = await import('../proxy/deadlock.js');
  for (const bad of [0, null, undefined, NaN, '']) {
    const result = await activeMatchFor(bad);
    assert.equal(result, null,
      `activeMatchFor(${JSON.stringify(bad)}) must short-circuit to null without calling the API`);
  }
});

test('legitimate asset paths still resolve', () => {
  assert.match(resolveStatic('/'), /index\.html$/);
  assert.match(resolveStatic('/index.html'), /index\.html$/);
  assert.match(resolveStatic('/fonts/radiance-bold.otf'), /fonts[/\\]radiance-bold\.otf$/);
  assert.match(resolveStatic('/logo/eye.svg'), /logo[/\\]eye\.svg$/);
});

test('normalize clamps .. at root — the property the guard leans on', () => {
  // The guard is only sufficient because normalize refuses to walk above root
  // on a /-prefixed path. If a future Node changes that, this fails first and
  // tells you the guard needs strengthening.
  assert.equal(normalize('/../x'), sep + 'x');
  assert.equal(normalize('/../../../x'), sep + 'x');
  assert.equal(normalize('/a/../../x'), sep + 'x');
});

/**
 * A colon in the path. On Windows this names an alternate data stream, and
 * `/index.html::$DATA` resolved to the real index.html — but carrying the wrong
 * extension, so extname() did not see it as code and the response was served
 * `max-age=86400` instead of `no-store`. That is the stale-overlay bug the
 * no-store header exists to prevent, reachable on the only platform this runs
 * on, by appending six characters to the URL.
 */
test('a path containing a colon is rejected outright', () => {
  for (const vector of ['/index.html::$DATA', '/index.html:stream',
                        '/C:/Windows/win.ini', '/overlay/app.js::$DATA',
                        '/app.js:', ':/index.html']) {
    assert.equal(resolveStatic(vector), null,
      `${vector} must not resolve to a servable path`);
  }
});

test('the ordinary paths still resolve', () => {
  // The guard must not have cost the thing the resolver is for.
  assert.match(resolveStatic('/'), /index\.html$/);
  assert.match(resolveStatic('/app.js'), /app\.js$/);
  assert.match(resolveStatic('/logo/outer.svg'), /outer\.svg$/);
  assert.match(resolveStatic('/heroes/20.webp'), /20\.webp$/);
});
