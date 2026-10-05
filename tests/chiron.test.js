import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TURNS } from '../overlay/chiron.js';

/**
 * TURNS is pure, exported, and needs no DOM, so there was never a reason for it
 * to be untested — and it was the only part of the overlay reading a key that
 * nothing writes (`session.rank`), which showed a dash on the broadcast beside
 * the real value from the same document. These tests exist to catch that class
 * of bug: a turn reading a field the proxy does not produce.
 */

/** A state document with every field the proxy actually puts on one. */
const doc = () => ({
  phase: 'IDLE',
  mode: 'normal',
  session: {
    todayRecord: '3-1', winRateToday: '75%', kd: '2.4', matches: '4',
    rankProgress: '+6', lastMatchAt: Date.now() - 20 * 60_000
  },
  operator: {
    accountId: 123456788, name: 'operator', isSelf: true, heroId: 15,
    rank: 'ARCHON II', season: '43-31', kd: '1.9', streak: 'W3',
    netWorth: '50,000', lastHits: '150', denies: '10', abandons: '1',
    matches: '74', form: 'WLLWLLLWWWW'
  },
  teams: [{ players: [] }, { players: [
    { name: 'opponent one', season: '10-9', rank: 'ORACLE I' },
    { name: 'opponent two', season: '4-4', rank: 'ALCHEMIST III' }
  ] }]
});

test('every turn returns groups whose values are all populated', () => {
  // The guard against reading a key nobody writes: given a document carrying
  // every real field, no group may come back as the '-' placeholder.
  const state = doc();
  for (const turn of TURNS) {
    for (const [label, value] of turn.groups(state)) {
      assert.notEqual(value, '-',
        `${turn.spine} / ${label} resolved to a dash against a fully populated document — ` +
        'it is probably reading a field the proxy does not produce');
      assert.ok(String(value ?? '').length > 0, `${turn.spine} / ${label} is empty`);
    }
  }
});

test('the Session turn shows the operator rank, not a session field', () => {
  const state = doc();
  const session = TURNS.find(t => t.spine === 'Session');
  const rank = session.groups(state).find(([label]) => label === 'Rank');
  assert.equal(rank[1], 'ARCHON II');
  assert.equal(rank[2], '+6', 'per-match movement stays as the qualifier');
});

test('a turn never throws on an empty document, it yields placeholders', () => {
  // The spec's "never render a hole" rule. renderTurn wraps groups() in a
  // try/catch, but a turn that throws loses all four groups, so not throwing
  // in the first place is the actual requirement.
  const empty = { session: {}, operator: null, teams: [{ players: [] }, { players: [] }] };
  for (const turn of TURNS) {
    const groups = turn.groups(empty);
    assert.ok(Array.isArray(groups), `${turn.spine} must return an array`);
    for (const group of groups) {
      // A group is [label, value, sub?]. Both of the first two must be strings
      // the renderer can set as textContent — undefined would render the word
      // "undefined" on the broadcast, which is worse than a dash.
      const [label, value] = group;
      assert.equal(typeof label, 'string', `${turn.spine} label must be a string`);
      assert.equal(typeof value, 'string',
        `${turn.spine} / ${label} gave ${typeof value}, which renders as its own name`);
    }
  }
});

test('the Matchup turn names opponents and is bounded to four', () => {
  const state = doc();
  state.teams[1].players = Array.from({ length: 9 }, (_, i) => ({
    name: `opponent ${i}`, season: '1-1', rank: 'SEEKER I'
  }));
  const matchup = TURNS.find(t => t.spine === 'Matchup');
  assert.equal(matchup.groups(state).length, 4, 'the chiron has four group slots');
});

test('a hostile persona name is passed through as data, never interpreted', () => {
  // Steam persona names are attacker-controlled by every player in the match.
  // The turn must hand the string along untouched; chiron.js renders it with
  // textContent, and tests/injection.test.js pins that it has no other option.
  const state = doc();
  const hostile = '<img src=x onerror="alert(1)">';
  state.teams[1].players = [{ name: hostile, season: '1-1', rank: 'SEEKER I' }];
  const [[label]] = TURNS.find(t => t.spine === 'Matchup').groups(state);
  assert.equal(label, hostile.slice(0, 14), 'truncated for width, but otherwise verbatim');
});
