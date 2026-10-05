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
  assert.match(row.rankColor, /^#[0-9A-F]{6}$/i, 'a colour is still required');
  assert.equal(row.form.length, 11, 'FORM still fills the board');
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

test('the operator is pinned first in their own faction', async () => {
  // ACCOUNT_ID is read from the environment when config.js is first loaded,
  // so it must be set BEFORE the dynamic import — and this test needs its own
  // module instance, which is why it imports rather than using the top-level
  // buildState. Without this the assertion is vacuous: nobody is ever isSelf.
  const target = match.players[4].account_id;
  process.env.DSN_ACCOUNT_ID = String(target);
  const fresh = await import(`../proxy/state.js?selftest=${target}`);

  const s = fresh.buildState({ match, steam, ranks, derived: fullDerived, session: {}, now: 1 });
  const all = s.teams.flatMap(t => t.players);

  const selves = all.filter(p => p.isSelf);
  assert.equal(selves.length, 1, 'exactly one row must be flagged as the operator');
  assert.equal(selves[0].accountId, target);

  const owning = s.teams.find(t => t.players.some(p => p.isSelf));
  assert.equal(owning.players[0].isSelf, true,
    'the operator must be row 0 of their own faction, not merely present');
  assert.equal(owning.players.length, 6, 'pinning must not change the faction size');

  delete process.env.DSN_ACCOUNT_ID;
});
