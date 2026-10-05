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
