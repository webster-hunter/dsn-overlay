import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildState, emptyState, fallbackState } from '../proxy/state.js';
import { derivePlayer } from '../proxy/derive.js';

const load = f => JSON.parse(readFileSync(`fixtures/${f}`, 'utf8'));
const match = load('active.sample.json');
const history = load('match-history.sample.json');
const stats = derivePlayer(history);
const good = buildState({
  match, steam: load('steam.sample.json'), ranks: load('rank.sample.json'),
  derived: new Map(match.players.map(p => [p.account_id, stats]))
});

test('a fallback keeps the last good roster rather than blanking', () => {
  const f = fallbackState(good, 'api down');
  assert.equal(f.teams[0].players.length, 6);
  assert.equal(f.teams[1].players.length, 6);
  assert.equal(f.stale, true);
});

test('a fallback with no previous state is still renderable', () => {
  const f = fallbackState(null, 'cold start');
  assert.equal(f.phase, 'IDLE');
  assert.ok(Array.isArray(f.teams));
  assert.equal(f.teams.length, 2);
});

test('a fallback from a cold-start document with no player rows refreshes generatedAt rather than freezing it', () => {
  // teams.length is 2 on every document this codebase emits, emptyState
  // included, so checking THAT tells fallbackState nothing about whether
  // there is a real roster to preserve. Pin a sentinel generatedAt far in
  // the past on a player-less "previous" doc (exactly what `current` holds
  // on a cold start) and confirm the fallback does NOT just spread it
  // forward — that would freeze the clock on the starting placeholder
  // forever instead of refreshing it on every failed tick.
  const cold = { ...emptyState('starting'), generatedAt: 1 };
  const f = fallbackState(cold, 'api down');
  assert.equal(f.teams[0].players.length, 0);
  assert.equal(f.teams[1].players.length, 0);
  assert.equal(f.stale, true);
  assert.notEqual(f.generatedAt, 1, 'generatedAt must not freeze on a cold start with no previous roster');
});

test('no state document ever contains undefined, NaN or null names', () => {
  for (const doc of [good, emptyState('x'), fallbackState(good, 'y'), fallbackState(null, 'z')]) {
    const json = JSON.stringify(doc);
    assert.doesNotMatch(json, /NaN/, 'NaN leaked into the document');
    assert.doesNotMatch(json, /"name":\s*(null|"")/, 'an empty name leaked');
  }
});

test('a malformed match payload degrades to IDLE instead of throwing', () => {
  // {}, { players: [] }, { players: null }, null and undefined are all
  // indistinguishable to buildState: every one trips the same
  // `!match?.players?.length` guard. Pinning one representative case rather
  // than five that can only pass or fail together.
  const doc = buildState({ match: undefined, steam: [], ranks: [], derived: new Map() });
  assert.equal(doc.phase, 'IDLE');
  assert.equal(doc.teams.length, 2);
});

test('garbage in the batch responses does not break the board', () => {
  const doc = buildState({
    match, steam: [null, { nope: 1 }], ranks: 'not an array',
    derived: new Map()
  });
  const all = doc.teams.flatMap(t => t.players);
  assert.equal(all.length, 12);
  for (const p of all) {
    assert.equal(p.form.length, 11);
    assert.ok(p.name.length > 0);
    assert.doesNotMatch(p.rank, /undefined/);
  }
});
