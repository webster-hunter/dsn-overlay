import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TURNS, heroIconUrl } from '../overlay/chiron.js';

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
    accountId: 123456788, name: 'operator', isSelf: true, heroId: null,
    heroPool: [
      { heroId: 15, matches: 40, last: true },
      { heroId: 1, matches: 12, last: false },
      { heroId: 20, matches: 1, last: false }
    ],
    rank: 'ARCHON II', season: '43-31', kd: '1.9', streak: 'W3',
    netWorth: '50,000', lastHits: '150', denies: '10', abandons: '1',
    matches: '74', form: 'WLLWLLLWWWW', matchLen: '30:12'
  },
  teams: [{ players: [] }, { players: [
    { name: 'opponent one', season: '10-9', rank: 'ORACLE I' },
    { name: 'opponent two', season: '4-4', rank: 'ALCHEMIST III' }
  ] }]
});

test('the three turns repeat no stat between them', () => {
  // Five turns became three because the four that survived the Matchup removal
  // repeated eight of their sixteen slots. Every label must now be unique, or
  // the cycle is showing the same number twice again.
  const labels = TURNS.flatMap(t => t.groups(doc()).map(([label]) => label));
  assert.equal(new Set(labels).size, labels.length,
    `a stat appears in more than one turn: ${labels.join(', ')}`);
  assert.equal(TURNS.length, 3);
});

test('every turn returns groups whose values are all populated', () => {
  // The guard against reading a key nobody writes: given a document carrying
  // every real field, no group may come back as the '-' placeholder.
  const state = doc();
  for (const turn of TURNS) {
    for (const [label, value] of turn.groups(state)) {
      if (value && typeof value === 'object') {
        // A hero-icon descriptor. Populated means it actually names a hero.
        assert.ok(Number.isInteger(value.heroId) && value.heroId > 0,
          `${turn.spine} / ${label} carries no usable hero id`);
        continue;
      }
      assert.notEqual(value, '-',
        `${turn.spine} / ${label} resolved to a dash against a fully populated document — ` +
        'it is probably reading a field the proxy does not produce');
      assert.ok(String(value ?? '').length > 0, `${turn.spine} / ${label} is empty`);
    }
  }
});

test('the hero icon url only accepts a small positive integer', () => {
  // The chiron's only URL sink. Same discipline as the chat emote builders:
  // nothing the API returned as a string can reach an img src.
  assert.equal(heroIconUrl(20), 'heroes/20.webp');
  assert.equal(heroIconUrl(1), 'heroes/1.webp');
  for (const bad of [0, -1, 1.5, 1_000_000, NaN, Infinity, null, undefined,
                     '20', '../../../etc/passwd', 'x', '1;rm -rf /', {}, []]) {
    assert.equal(heroIconUrl(bad), null, `heroIconUrl(${JSON.stringify(bad)}) must be refused`);
  }
});

const heroTurn = () => TURNS.find(t => t.spine === 'Hero');
const heroGroup = (state, cycle) =>
  heroTurn().groups(state, cycle).find(([label]) => label === 'Hero');

test('the Hero turn rotates through the pool, one hero per chiron cycle', () => {
  // heroId is only set during a match, and with no live roster that is almost
  // never — so between games the turn steps through the pool instead of
  // holding one icon for the whole stream.
  const state = doc();
  const seen = [0, 1, 2].map(cycle => heroGroup(state, cycle)[1].heroId);
  assert.deepEqual(seen, [15, 1, 20], 'last-played first, then most-played');
});

test('the rotation wraps rather than running off the end of the pool', () => {
  const state = doc();
  assert.equal(heroGroup(state, 3)[1].heroId, 15, 'cycle 3 returns to the start');
  assert.equal(heroGroup(state, 97)[1].heroId, heroGroup(state, 1)[1].heroId);
});

test('the qualifier says why this hero is on screen', () => {
  const state = doc();
  assert.equal(heroGroup(state, 0)[2], 'last played');
  assert.equal(heroGroup(state, 1)[2], '12 matches');
  assert.equal(heroGroup(state, 2)[2], '1 match', 'singular, not "1 matches"');

  state.operator.heroId = 7;
  assert.equal(heroGroup(state, 0)[2], 'playing now');
  assert.equal(heroGroup(state, 0)[1].heroId, 7, 'a live hero beats the pool');
});

test('an empty pool yields a placeholder rather than throwing', () => {
  // A brand-new account, or one whose history fetch failed.
  const state = doc();
  state.operator.heroPool = [];
  const hero = heroGroup(state, 4);
  assert.equal(hero[1].heroId, null);
  assert.equal(hero[2], '', 'no qualifier to offer');
});

test('the Today turn shows the operator rank, not a session field', () => {
  const state = doc();
  const today = TURNS.find(t => t.spine === 'Today');
  const rank = today.groups(state).find(([label]) => label === 'Rank');
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
      // A group is [label, value, sub?]. The label is always a string; the
      // value is a string the renderer sets as textContent, or a hero-icon
      // descriptor it draws as an image. Anything else gets stringified into
      // the DOM, which is how the word "undefined" reaches a broadcast.
      const [label, value] = group;
      assert.equal(typeof label, 'string', `${turn.spine} label must be a string`);
      if (value && typeof value === 'object') {
        assert.deepEqual(Object.keys(value), ['heroId'],
          `${turn.spine} / ${label} is an object but not a hero descriptor`);
        assert.ok(value.heroId === null || Number.isInteger(value.heroId),
          `${turn.spine} / ${label} heroId must be an integer or null, got ${value.heroId}`);
        continue;
      }
      assert.equal(typeof value, 'string',
        `${turn.spine} / ${label} gave ${typeof value}, which renders as its own name`);
    }
  }
});

test('no turn depends on a live roster', () => {
  // The Matchup turn was removed because it needed opponents the API cannot
  // supply. Nothing may quietly reintroduce that dependency: with both teams
  // empty, every turn must still produce four usable groups.
  const state = doc();
  state.teams = [{ players: [] }, { players: [] }];
  for (const turn of TURNS) {
    const groups = turn.groups(state);
    for (const [label, value] of groups) {
      const text = value && typeof value === 'object' ? String(value.heroId) : value;
      assert.notEqual(text, '-',
        `${turn.spine} / ${label} went blank with no roster, so it reads one`);
    }
  }
});
