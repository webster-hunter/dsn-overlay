import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAccountId, STEAM64_BASE } from '../proxy/steamid.js';

// One real account, as Steam renders it in four different places.
const ACCOUNT_ID = 900000008;
const STEAM64 = '76561198083722516';

test('all four Steam forms resolve to the same account id', () => {
  assert.equal(toAccountId(ACCOUNT_ID), ACCOUNT_ID);           // friend code
  assert.equal(toAccountId(STEAM64), ACCOUNT_ID);              // profile URL
  assert.equal(toAccountId('[U:1:900000008]'), ACCOUNT_ID);   // steamid.io
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
  assert.equal(toAccountId('  900000008  '), ACCOUNT_ID);
  assert.equal(toAccountId('U:1:900000008'), ACCOUNT_ID);
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

test('a value too large for a 32-bit account id is rejected', () => {
  assert.equal(toAccountId('999999999999999999999'), 0);
});
