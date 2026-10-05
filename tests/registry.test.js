import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATS, rankStats } from '../proxy/registry.js';

const stateWith = over => ({
  phase: 'MATCH',
  session: {},
  teams: [{ faction: 'Hidden King', colorVar: '--team-amber', players: [
    { isSelf: true, name: 'me', season: '147-117', matches: '264',
      streak: 'W4', kd: '2.4', abandons: '0', rank: 'ORACLE 5',
      netWorth: '71.2k', lastHits: '214', denies: '14', form: 'WWLWWLWWWL ',
      ...over }
  ] }, { faction: 'Archmother', colorVar: '--team-sapphire', players: [] }],
  generatedAt: 0
});

test('every stat declares the full contract', () => {
  assert.ok(STATS.length > 0);
  for (const s of STATS) {
    assert.equal(typeof s.key, 'string');
    assert.equal(typeof s.label, 'string');
    assert.equal(typeof s.minSample, 'number');
    assert.equal(typeof s.compute, 'function');
    assert.equal(typeof s.salience, 'function');
  }
});

test('a stat below its sample floor never airs', () => {
  const thin = stateWith({ matches: '3' });
  const keys = rankStats(thin).map(s => s.key);
  assert.ok(!keys.includes('seasonWinRate'),
    'a 3-match season must not be presented as a win rate');
});

test('a stat above its floor does air', () => {
  const keys = rankStats(stateWith({})).map(s => s.key);
  assert.ok(keys.includes('seasonWinRate'));
});

test('results are sorted by descending salience', () => {
  const ranked = rankStats(stateWith({}));
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].salience >= ranked[i].salience,
      'must be descending');
  }
});

test('a longer streak is more salient than a shorter one', () => {
  const find = (st, key) => rankStats(st).find(s => s.key === key)?.salience ?? 0;
  assert.ok(find(stateWith({ streak: 'W6' }), 'streak')
          > find(stateWith({ streak: 'W2' }), 'streak'));
});

test('an empty or malformed state yields no stats rather than throwing', () => {
  assert.deepEqual(rankStats({ teams: [], session: {} }), []);
  assert.deepEqual(rankStats({}), []);
  assert.deepEqual(rankStats(null), []);
});
