import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const load = f => JSON.parse(readFileSync(`fixtures/${f}`, 'utf8'));

test('match-history fixture has the fields derive.js needs', () => {
  assert.ok(existsSync('fixtures/match-history.sample.json'),
    'run `npm run fixtures`');
  const rows = load('match-history.sample.json');
  assert.ok(rows.length >= 30, `want >= 30 entries, got ${rows.length}`);
  for (const f of ['match_id', 'start_time', 'player_team', 'match_result',
                   'player_kills', 'player_deaths', 'net_worth', 'last_hits',
                   'denies', 'hero_id', 'match_duration_s', 'abandoned_time_s']) {
    assert.ok(f in rows[0], `entry missing ${f}`);
  }
});

test('match-history fixture abandon coverage (informational)', () => {
  const rows = load('match-history.sample.json');
  const ab = rows.filter(r => typeof r.abandoned_time_s === 'number' && r.abandoned_time_s > 0);
  // Deliberately NOT an assertion. Abandons occur at ~0.09%, so whether the
  // recorded subject has one is a roster lottery, and a suite that fails on
  // unlucky data teaches people to re-run instead of read. The real gate for
  // the 0-vs-null sentinel is Task 4's synthetic tests, which are
  // deterministic and pin it from both sides.
  console.log(`      fixture abandons: ${ab.length} of ${rows.length} entries`);
  assert.ok(Array.isArray(rows), 'fixture parses');
});

test('active fixture carries a 12-player roster', () => {
  const m = load('active.sample.json');
  assert.equal(m.players.length, 12);
  for (const f of ['account_id', 'team', 'hero_id']) assert.ok(f in m.players[0]);
});

test('rank fixture carries tier and subrank', () => {
  const r = load('rank.sample.json')[0];
  assert.equal(typeof r.rank, 'number');
  assert.equal(typeof r.subrank, 'number');
});
