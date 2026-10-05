import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildState, emptyState } from '../proxy/state.js';
import { derivePlayer } from '../proxy/derive.js';

const load = f => JSON.parse(readFileSync(`fixtures/${f}`, 'utf8'));
const match = load('active.sample.json');
const steam = load('steam.sample.json');
const ranks = load('rank.sample.json');
const history = load('match-history.sample.json');

/**
 * buildState takes PRE-DERIVED stats, not raw histories — the caller reduces
 * each 2.5MB payload and releases it. Every roster member gets the same
 * derived block here, which is enough to exercise the document's shape.
 */
const stats = derivePlayer(history);
const fullDerived = new Map(match.players.map(p => [p.account_id, stats]));

test('builds two teams of six from a 12-player roster', () => {
  const s = buildState({ match, steam, ranks, derived: fullDerived, session: {}, now: 1 });
  assert.equal(s.phase, 'MATCH');
  assert.equal(s.teams.length, 2);
  assert.equal(s.teams[0].players.length, 6);
  assert.equal(s.teams[1].players.length, 6);
  assert.equal(s.teams[0].faction, 'Hidden King');
  assert.equal(s.teams[1].faction, 'Archmother');
});

test('every player row carries board-ready strings within the cell budget', () => {
  const s = buildState({ match, steam, ranks, derived: fullDerived, session: {}, now: 1 });
  for (const team of s.teams) {
    for (const p of team.players) {
      assert.equal(p.form.length, 11, 'FORM must fill all 11 cells');
      assert.ok(p.season.length <= 11, `season "${p.season}" too long`);
      assert.ok(p.rank.length <= 11, `rank "${p.rank}" too long`);
      assert.ok(String(p.abandons).length <= 11);
      assert.doesNotMatch(p.rank, /undefined|NaN/);
      assert.equal(typeof p.name, 'string');
      assert.ok(p.name.length > 0, 'a name must never be empty');
    }
  }
});

test('emptyState is renderable and never throws', () => {
  const s = emptyState('no match');
  assert.equal(s.phase, 'IDLE');
  assert.equal(s.teams.length, 2);
  assert.deepEqual(s.teams[0].players, []);
});

test('a player absent from steam and rank keeps the board at 12 rows', () => {
  const victim = match.players[3].account_id;
  const s = buildState({
    match,
    steam: steam.filter(r => r.account_id !== victim),
    ranks: ranks.filter(r => r.account_id !== victim),
    derived: fullDerived, session: {}, now: 1
  });

  const all = s.teams.flatMap(t => t.players);
  assert.equal(all.length, 12, 'the row must survive, not be dropped');
  assert.equal(s.teams[0].players.length, 6, 'factions must not shift');
  assert.equal(s.teams[1].players.length, 6);

  const row = all.find(p => p.accountId === victim);
  assert.equal(row.name, 'UNKNOWN');
  assert.equal(row.rank, 'UNRANKED');
  assert.equal(row.form.length, 11, 'FORM is a fixed width and must still fill it');
});

test('a player whose history fetch failed entirely still renders', () => {
  // mapLimited maps a failed per-item fetch to null, so that account never
  // reaches the derived map at all — a different case from "fetched, but
  // empty". EMPTY_DERIVED exists for exactly this, and nothing exercised it.
  const victim = match.players[7].account_id;
  const partial = new Map(fullDerived);
  partial.delete(victim);

  const s = buildState({ match, steam, ranks, derived: partial, session: {}, now: 1 });
  const all = s.teams.flatMap(t => t.players);
  assert.equal(all.length, 12, 'the row must survive a missing derived entry');

  const row = all.find(p => p.accountId === victim);
  assert.equal(row.form.length, 11, 'FORM is a fixed width and must still fill it');
  assert.equal(row.season, '0-0');
  assert.equal(row.abandons, '0');
  assert.equal(row.matches, '0');
  assert.equal(row.streak, '0');
  assert.ok(row.name.length > 0, 'the name comes from steam, not from history');
  // Checked field by field, not against the serialised blob. The old regex
  // banned the substrings "null"/"undefined" anywhere in the JSON, which also
  // outlawed a field whose value is legitimately null — `lastHero` on an
  // account with no history is exactly that, and so is `heroId` on any idle
  // document. What must never happen is a value RENDERED as the text "NaN" or
  // "undefined", because that is what reaches the broadcast.
  for (const [key, value] of Object.entries(row)) {
    if (value === null) continue;                       // an honest "no data"
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    assert.ok(typeof value !== 'number' || Number.isFinite(value),
      `${key} is ${value}, which renders as its own name`);
    if (typeof value === 'string') {
      assert.doesNotMatch(value, /NaN|undefined/,
        `${key} = "${value}" would put that word on the broadcast`);
    }
  }
});

test('a player with no history at all still renders', () => {
  const thin = new Map(match.players.map(p => [p.account_id, derivePlayer([])]));
  const s = buildState({ match, steam, ranks, derived: thin, session: {}, now: 1 });
  for (const p of s.teams.flatMap(t => t.players)) {
    assert.equal(p.form.length, 11);
    assert.equal(p.season, '0-0');
    assert.equal(p.abandons, '0');
    assert.ok(!/NaN/.test(JSON.stringify(p)), `NaN leaked into ${p.accountId}`);
  }
});

test('the operator is pinned first in their own faction', () => {
  // operatorId is an argument, so this needs no env var and no module-cache
  // trickery. An earlier draft tried `import('../proxy/state.js?bust=1')` after
  // setting process.env — that does not work: the query re-evaluates state.js
  // but its relative import of ./config.js resolves to the already-cached URL,
  // so ACCOUNT_ID stayed frozen at 0 and the assertion failed. Verified
  // empirically. Passing the id in is both simpler and actually correct.
  const target = match.players[4].account_id;
  const s = buildState({
    match, steam, ranks, derived: fullDerived, operatorId: target, session: {}, now: 1
  });

  const all = s.teams.flatMap(t => t.players);
  const selves = all.filter(p => p.isSelf);
  assert.equal(selves.length, 1, 'exactly one row must be flagged as the operator');
  assert.equal(selves[0].accountId, target);

  const owning = s.teams.find(t => t.players.some(p => p.isSelf));
  assert.equal(owning.players[0].isSelf, true,
    'the operator must be row 0 of their own faction, not merely present');
  assert.equal(owning.players.length, 6, 'pinning must not change the faction size');
});

test('with no operatorId, nobody is flagged — and nothing is reordered', () => {
  // The unconfigured case. It must not silently pick a row, and it must not
  // crash: the overlay still renders a full 12-row board with no YOU tag.
  const s = buildState({ match, steam, ranks, derived: fullDerived, session: {}, now: 1 });
  const all = s.teams.flatMap(t => t.players);
  assert.equal(all.length, 12);
  assert.equal(all.filter(p => p.isSelf).length, 0, 'no row may claim to be the operator');
  assert.equal(s.teams[0].players.length, 6);
  assert.equal(s.teams[1].players.length, 6);
});

test('a player with no rank reads UNRANKED, not the lowest tier', () => {
  // The API returns a row for everyone and fills it with rank 0 / subrank 0 /
  // last_match null when there is no rank yet. Tier 0 is a real name
  // ("Obscurus"), so taking the row at face value tells a broadcast its
  // streamer is the lowest rank in the game when they are merely unranked.
  const doc = buildState({
    match: { match_id: 1, players: [{ account_id: 7, hero_id: 1, team: 0 }] },
    steam: [{ account_id: 7, personaname: 'nobody' }],
    ranks: [{ account_id: 7, badge: 0, rank: 0, subrank: 0, last_match: null }],
    derived: new Map(), operatorId: 7
  });
  const row = doc.teams.flatMap(t => t.players)[0];
  assert.equal(row.rank, 'UNRANKED');
  assert.notEqual(row.rank, 'OBSCURUS');
});

test('a real rank is still rendered as its tier', () => {
  const doc = buildState({
    match: { match_id: 1, players: [{ account_id: 7, hero_id: 1, team: 0 }] },
    steam: [{ account_id: 7, personaname: 'somebody' }],
    ranks: [{ account_id: 7, badge: 115, rank: 11, subrank: 5 }],
    derived: new Map(), operatorId: 7
  });
  assert.equal(doc.teams.flatMap(t => t.players)[0].rank, 'ETERNUS 5');
});

test('a brawl match shows brawl stats, and says so', () => {
  const derived = new Map([[7, {
    form: 'WWWWWWWWWWW', season: { text: '99-1' }, abandons: 2, streak: { kind: 'W', n: 9 },
    averages: { kd: 5, netWorth: 1000, lastHits: 100, denies: 9 }, matches: 100,
    brawl: { form: 'LLLLLLLLLLL', season: { text: '1-99' }, abandons: 0, streak: { kind: 'L', n: 9 },
             averages: { kd: 0.5, netWorth: 500, lastHits: 20, denies: 0 }, matches: 7 }
  }]]);
  const base = { steam: [{ account_id: 7, personaname: 'p' }], ranks: [], derived, operatorId: 7 };

  const normal = buildState({ ...base, match: { match_id: 1, game_mode: 1, players: [{ account_id: 7, hero_id: 1, team: 0 }] } });
  const brawl  = buildState({ ...base, match: { match_id: 2, game_mode: 4, players: [{ account_id: 7, hero_id: 1, team: 0 }] } });

  assert.equal(normal.mode, 'normal');
  assert.equal(brawl.mode, 'brawl', 'the document names the mode so the UI can label it');
  assert.equal(normal.teams.flatMap(t => t.players)[0].season, '99-1');
  assert.equal(brawl.teams.flatMap(t => t.players)[0].season, '1-99', 'brawl must not show the normal record');
  // brawl records no denies at all, so a 0 would read as "you denied nothing"
  assert.equal(brawl.teams.flatMap(t => t.players)[0].denies, '-');
  assert.equal(normal.teams.flatMap(t => t.players)[0].denies, '9');
});
