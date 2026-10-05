import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyState, fallbackState, operatorRow } from '../proxy/state.js';
import { derivePlayer } from '../proxy/derive.js';

/**
 * Spec section 9: never render a hole. On a live broadcast the failure that
 * matters is not an error message, it is the board going blank — so every
 * upstream failure has to degrade to last-known-good or to dashes.
 */
const ACCOUNT = 900000001;
const history = JSON.parse(readFileSync('fixtures/match-history.sample.json', 'utf8'));
const steam = JSON.parse(readFileSync('fixtures/steam.sample.json', 'utf8'));
const ranks = JSON.parse(readFileSync('fixtures/rank.sample.json', 'utf8'));
const derived = new Map([[ACCOUNT, derivePlayer(history)]]);
const good = () => emptyState('ok', {
  operator: operatorRow({ accountId: ACCOUNT, steam, ranks, derived }),
  session: { todayRecord: '3-1' }
});

test('a fallback keeps the last good document rather than blanking it', () => {
  const previous = good();
  const out = fallbackState(previous, 'upstream exploded');
  assert.equal(out.stale, true);
  assert.equal(out.reason, 'upstream exploded');
  assert.equal(out.operator.accountId, ACCOUNT, 'the row survives the outage');
  assert.equal(out.session.todayRecord, '3-1', 'and so does the session block');
});

test('the fallback condition names something the document still has', () => {
  // It keyed on `previous.teams` having a player row. `teams` was removed with
  // the roster, which made that test silently false — so EVERY failure, even
  // one following a perfectly good fetch, threw the last good document away and
  // served the empty one. A condition about a field that no longer exists does
  // not fail loudly; it just stops being true.
  const out = fallbackState(good(), 'x');
  assert.ok(out.operator, 'a document with an operator row must be preserved');
});

test('a fallback with no previous state is still renderable', () => {
  const out = fallbackState(null, 'cold start failed');
  assert.equal(out.stale, true);
  assert.equal(out.phase, 'IDLE');
  assert.equal(out.operator, null);
  assert.equal(out.reason, 'cold start failed');
});

test('a cold-start failure refreshes generatedAt rather than freezing it', () => {
  // Without this the starting placeholder's timestamp would stick for the whole
  // broadcast, and the overlay's freshness line would stop advancing — which is
  // the one signal that says the proxy has stopped working.
  const first = fallbackState(emptyState('starting'), 'still down');
  const later = fallbackState(emptyState('starting'), 'still down');
  assert.ok(later.generatedAt >= first.generatedAt);
  assert.equal(later.operator, null, 'there was never a row to keep');
});

test('no document ever carries undefined, NaN or an empty name', () => {
  for (const doc of [emptyState(), good(), fallbackState(good(), 'x'),
                     fallbackState(null, 'y')]) {
    const json = JSON.stringify(doc);
    assert.doesNotMatch(json, /NaN/, 'NaN would render as the word NaN');
    assert.doesNotMatch(json, /:\s*"undefined"/, 'a stringified undefined');
    if (doc.operator) {
      assert.ok(doc.operator.name.length > 0, 'a row always has some name');
    }
  }
});

test('garbage in the batch responses does not break the row', () => {
  // The batch endpoints are documented loosely enough that a null row, a
  // string, or a missing account_id are all possible.
  const junk = [null, undefined, 'nope', 42, {}, { account_id: null },
                { account_id: ACCOUNT, personaname: null }];
  const r = operatorRow({ accountId: ACCOUNT, steam: junk, ranks: junk, derived });
  assert.ok(r, 'a row is still produced');
  assert.ok(r.name.length > 0, 'falling back to the placeholder name');
  assert.equal(r.rank, 'UNRANKED', 'no usable rank row means unranked');
});

test('derivePlayer always returns the shape the row builder indexes into', () => {
  // playerRow reads d.averages.kd, d.season.text, d.streak.kind and so on, and
  // only substitutes EMPTY_DERIVED when the map has NOTHING for the account —
  // a half-built object would throw on the first nested read. So rather than
  // guarding a path that cannot occur (the map is filled in one place, from
  // this function), the invariant that makes the guard unnecessary is what gets
  // asserted. If deriveMode ever returns less than this, the row builder needs
  // the guard and this test says so first.
  for (const entries of [[], null, undefined, history, [{}], [{ hero_id: 1 }]]) {
    const d = derivePlayer(entries);
    assert.equal(typeof d.season?.text, 'string', 'season.text');
    assert.equal(typeof d.form, 'string', 'form');
    assert.equal(typeof d.streak?.kind, d.streak?.kind === null ? 'object' : 'string');
    assert.equal(typeof d.averages?.kd, 'number', 'averages.kd');
    for (const avg of ['netWorth', 'lastHits', 'denies', 'matchLen']) {
      assert.equal(typeof d.averages?.[avg], 'number', `averages.${avg}`);
    }
    assert.ok(Array.isArray(d.heroPool), 'heroPool');
    assert.ok(d.brawl?.averages, 'the brawl block is always present too');
  }
});
