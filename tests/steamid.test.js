import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAccountId, STEAM64_BASE } from '../proxy/steamid.js';

// One real account, as Steam renders it in four different places.
const ACCOUNT_ID = 123456788;
const STEAM64 = '76561198083722516';

test('all four Steam forms resolve to the same account id', () => {
  assert.equal(toAccountId(ACCOUNT_ID), ACCOUNT_ID);           // friend code
  assert.equal(toAccountId(STEAM64), ACCOUNT_ID);              // profile URL
  assert.equal(toAccountId('[U:1:123456788]'), ACCOUNT_ID);   // steamid.io
  assert.equal(toAccountId('STEAM_0:0:61728394'), ACCOUNT_ID); // legacy
});

test('the SteamID64 conversion is the documented offset, not a guess', () => {
  assert.equal(BigInt(STEAM64) - STEAM64_BASE, BigInt(ACCOUNT_ID));
});

test('an odd legacy id keeps its low bit', () => {
  // STEAM_0:1:N is 2N+1, so dropping the Y field would be off by one.
  assert.equal(toAccountId('STEAM_0:1:61728394'), ACCOUNT_ID + 1);
});

test('surrounding whitespace and a bare U:1: form are tolerated', () => {
  assert.equal(toAccountId('  123456788  '), ACCOUNT_ID);
  assert.equal(toAccountId('U:1:123456788'), ACCOUNT_ID);
});

test('unusable input resolves to 0, so the proxy stays idle', () => {
  // 0 is what config treats as "not set". An unconfigured proxy must never
  // look for a match, because the upstream endpoint ignores a falsy id and
  // returns every active match.
  for (const bad of ['', '   ', null, undefined, 'notanid', 'https://steamcommunity.com/id/me',
                     '0', '-5', 'STEAM_0:2:1', '[U:2:123]']) {
    assert.equal(toAccountId(bad), 0, `${JSON.stringify(bad)} must not resolve`);
  }
});

test('the base itself is not a valid account', () => {
  // base + 0 would be account id 0, which is the unconfigured sentinel.
  assert.equal(toAccountId(String(STEAM64_BASE)), 0);
});

test('a value too large for a 32-bit account id is rejected, in every form', () => {
  // Was named this while asserting one input on the one branch that already
  // clamped. The other two returned 1e+23 and 2e+23 — both truthy, so an
  // unconfigured-looking proxy sailed past the "is it set" guard and sent real
  // upstream requests built from a nonsense id.
  const huge = '99999999999999999999999';
  assert.equal(toAccountId(huge), 0, 'bare digits');
  assert.equal(toAccountId('[U:1:' + huge + ']'), 0, 'SteamID3');
  assert.equal(toAccountId('U:1:' + huge), 0, 'SteamID3, unbracketed');
  assert.equal(toAccountId('STEAM_0:1:' + huge), 0, 'legacy');
  assert.equal(toAccountId('STEAM_0:0:' + huge), 0, 'legacy, low bit clear');

  // Exactly at the boundary, from both directions, so the bound is pinned
  // rather than merely "a big number fails".
  assert.equal(toAccountId('[U:1:4294967295]'), 4294967295, '2^32-1 is the last valid id');
  assert.equal(toAccountId('[U:1:4294967296]'), 0, '2^32 is one too far');
  assert.equal(toAccountId('[U:1:0]'), 0, 'zero is the unconfigured sentinel');
});

test('every real form of one account still converts to the same id', () => {
  // The bound must not have cost the thing the function exists for. These are
  // the four forms Steam shows for a single account.
  const forms = ['123456788', '76561198083722516', '[U:1:123456788]', 'STEAM_0:0:61728394'];
  for (const f of forms) {
    assert.equal(toAccountId(f), 123456788, f + ' must resolve to the account id');
  }
});
