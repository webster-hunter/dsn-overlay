import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCache } from '../proxy/cache.js';

test('returns a stored value within its TTL', () => {
  const c = makeCache(1000);
  c.set('k', { a: 1 });
  assert.deepEqual(c.get('k'), { a: 1 });
  assert.equal(c.stale('k'), false);
});

test('reports stale past the TTL but still returns the value', () => {
  let now = 0;
  const c = makeCache(1000, () => now);
  c.set('k', 'v');
  now = 1500;
  assert.equal(c.stale('k'), true);
  assert.equal(c.get('k'), 'v',
    'a stale value is still served — never render a hole, spec section 9');
});

test('an unknown key is undefined and stale', () => {
  const c = makeCache(1000);
  assert.equal(c.get('nope'), undefined);
  assert.equal(c.stale('nope'), true);
});
