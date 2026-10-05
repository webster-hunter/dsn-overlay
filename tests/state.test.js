import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyState, operatorRow } from '../proxy/state.js';
import { derivePlayer } from '../proxy/derive.js';

/**
 * The state document is one operator row plus a session block. It used to carry
 * a 12-player roster, and these tests used to be about that — two teams of six,
 * the operator pinned first in their faction, a board of 12 rows. All of it was
 * removed with the Matchup turn: the API cannot report a live match's players,
 * nothing on screen showed them, and filling `teams` cost twelve Steam
 * profiles, twelve rank rows and twelve histories at ~18.5 MB.
 *
 * What survives here is every contract that was about ONE row, because that row
 * is now the whole document.
 */
const ACCOUNT = 900000001;
const history = JSON.parse(readFileSync('fixtures/match-history.sample.json', 'utf8'));
const steam = JSON.parse(readFileSync('fixtures/steam.sample.json', 'utf8'));
const ranks = JSON.parse(readFileSync('fixtures/rank.sample.json', 'utf8'));
const derived = new Map([[ACCOUNT, derivePlayer(history)]]);

const row = (over = {}) => operatorRow({
  accountId: ACCOUNT, steam, ranks, derived, ...over
});

test('emptyState is renderable and never throws', () => {
  const s = emptyState('nothing doing');
  assert.equal(s.phase, 'IDLE');
  assert.equal(s.operator, null);
  assert.equal(s.matchId, null);
  assert.deepEqual(s.session, {});
  assert.equal(typeof s.generatedAt, 'number');
  assert.equal(s.reason, 'nothing doing');
});

test('the document carries no roster', () => {
  // Pinned so the 18.5 MB fetch cannot come back by accident: nothing renders
  // opponents, so nothing should be assembling them.
  for (const doc of [emptyState(), emptyState('x', { operator: row() })]) {
    assert.equal(doc.teams, undefined, '`teams` was removed with the Matchup turn');
    assert.equal(doc.factions, undefined, '`factions` went with it');
  }
});

test('every value on the row is a string the chiron can render', () => {
  const r = row();
  // The chiron sets these with textContent, so a number or undefined would
  // reach the broadcast as its own stringification.
  for (const key of ['name', 'rank', 'season', 'kd', 'streak', 'netWorth',
                     'lastHits', 'denies', 'matches', 'abandons', 'form', 'matchLen']) {
    assert.equal(typeof r[key], 'string', `${key} must be a string, got ${typeof r[key]}`);
    assert.doesNotMatch(r[key], /NaN|undefined/, `${key} = "${r[key]}"`);
  }
  assert.equal(r.form.length, 11, 'FORM is a fixed width and must fill it');
});

test('the hero pool is a list of usable heroes', () => {
  const r = row();
  assert.ok(Array.isArray(r.heroPool));
  assert.ok(r.heroPool.length > 0, 'the fixture history has heroes in it');
  assert.ok(r.heroPool.length <= 6, 'the pool is capped at six');
  assert.equal(r.heroPool.filter(h => h.last).length, 1, 'exactly one last-played');
  assert.equal(r.heroPool[0].last, true, 'and it leads');
  for (const h of r.heroPool) {
    assert.ok(Number.isInteger(h.heroId) && h.heroId > 0, `bad heroId ${h.heroId}`);
    assert.ok(Number.isInteger(h.matches) && h.matches > 0, `bad count ${h.matches}`);
  }
});

test('an operator absent from steam and rank still renders', () => {
  // A private profile, or a batch response that omitted the row.
  const r = operatorRow({ accountId: ACCOUNT, steam: [], ranks: [], derived });
  assert.ok(r.name.length > 0, 'a placeholder name, not an empty string');
  assert.equal(r.rank, 'UNRANKED');
  assert.equal(r.season, derivePlayer(history).season.text, 'history still applies');
});

test('an operator with no history at all still renders', () => {
  // EMPTY_DERIVED exists for exactly this: mapLimited used to map a failed
  // per-item fetch to null, so the account never reached the derived map.
  const r = operatorRow({ accountId: ACCOUNT, steam, ranks, derived: new Map() });
  assert.equal(r.form.length, 11);
  assert.equal(r.season, '0-0');
  assert.equal(r.matches, '0');
  assert.equal(r.streak, '0');
  assert.deepEqual(r.heroPool, [], 'no history means no heroes to rotate');
  for (const [key, value] of Object.entries(r)) {
    if (value === null) continue;
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'string') assert.doesNotMatch(value, /NaN|undefined/, key);
  }
});

test('no account id yields no row, rather than a row for nobody', () => {
  for (const bad of [0, -1, null, undefined, NaN]) {
    assert.equal(operatorRow({ accountId: bad, steam, ranks, derived }), null,
      `accountId ${bad} must not produce a row`);
  }
});

test('an unranked account reads UNRANKED, not the lowest tier', () => {
  // The API fills rank 0 / subrank 0 for an account with no rank, and tier 0 is
  // a real name ("Obscurus") — so rendering it as-is tells a broadcast its
  // streamer is the lowest rank in the game when they are simply unranked.
  const unranked = [{ account_id: ACCOUNT, rank: 0, subrank: 0, badge: 0 }];
  assert.equal(row({ ranks: unranked }).rank, 'UNRANKED');
});

test('a real rank is still rendered as its tier', () => {
  const ranked = [{ account_id: ACCOUNT, rank: 10, subrank: 6, badge: 106 }];
  assert.equal(row({ ranks: ranked }).rank, 'ASCENDANT 6');
});

test('brawl mode shows brawl stats, and denies read as a dash', () => {
  // Brawl has no lane phase, so a denies average would be meaningless rather
  // than zero. The two modes are derived separately from one history.
  const normal = row({ mode: 'normal' });
  const brawl = row({ mode: 'brawl' });
  assert.equal(normal.mode, 'normal');
  assert.equal(brawl.mode, 'brawl');
  assert.equal(brawl.denies, '-');
  assert.notEqual(brawl.season, normal.season, 'the two modes are scored apart');
});

test('match length is formatted as m:ss, not as a count of seconds', () => {
  assert.match(row().matchLen, /^(-|\d+:[0-5]\d)$/, `got "${row().matchLen}"`);
});
