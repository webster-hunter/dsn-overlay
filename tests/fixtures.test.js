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

test('the fixtures carry one account, not a roster', () => {
  // They used to hold a full 12-player match because the overlay rendered one.
  // Nothing does — the API cannot report a live roster and no turn shows
  // opponents — so recording eleven more people to use one of them was data
  // this project had no reason to hold. The roster sample is gone with it.
  assert.throws(() => load('active.sample.json'),
    'active.sample.json must not come back: nothing reads a roster');
  for (const f of ['steam.sample.json', 'rank.sample.json']) {
    assert.equal(load(f).length, 1, `${f} should describe one account`);
  }
});

test('rank fixture carries tier and subrank', () => {
  const r = load('rank.sample.json')[0];
  assert.equal(typeof r.rank, 'number');
  assert.equal(typeof r.subrank, 'number');
});

test('steam fixture carries what the chiron renders', () => {
  const rows = load('steam.sample.json');
  assert.equal(rows.length, 1);
  for (const r of rows) {
    assert.equal(typeof r.account_id, 'number');
    assert.equal(typeof r.personaname, 'string');
    assert.ok(r.personaname.length > 0, 'a name must never be empty');
  }
});

test('steam fixture commits no unused personal data', () => {
  // The live endpoint also returns `friends` (1,000+ {account_id, friend_since}
  // records for one account), `realname` and `countrycode`. The overlay reads
  // none of them, and committing them would put a social graph of a thousand
  // third parties into git history permanently. The recorder projects the
  // response; this stops that projection being dropped.
  const allowed = new Set(['account_id', 'personaname']);
  for (const row of load('steam.sample.json')) {
    for (const key of Object.keys(row)) {
      assert.ok(allowed.has(key),
        `steam fixture leaked "${key}" — the recorder must project to ${[...allowed].join(', ')}`);
    }
  }
});
