import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newestStart, sessionToday } from '../proxy/derive.js';
import { ageLabel } from '../overlay/chiron.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** A countable (Normal, 6v6) history entry. game_mode 1 is what isCountable wants. */
const entry = (startSec, extra = {}) => ({
  start_time: startSec, game_mode: 1, match_mode: 1,
  player_kills: 0, player_deaths: 0, match_result: 1, player_team: 1,
  ...extra
});

test('newestStart returns the newest start_time in epoch ms', () => {
  const at = newestStart([entry(1000), entry(5000), entry(3000)]);
  assert.equal(at, 5_000_000);
});

test('newestStart returns null when nothing carries a usable time', () => {
  for (const input of [[], null, undefined, [{}], [{ start_time: 0 }], [{ start_time: 'x' }]]) {
    assert.equal(newestStart(input), null, `unexpected value for ${JSON.stringify(input)}`);
  }
});

test('sessionToday carries lastMatchAt even when no match was played today', () => {
  // The whole point of the signal: an empty session block is exactly when the
  // streamer cannot tell "I have not played" from "the API has not caught up".
  const yesterday = Math.floor((Date.now() - 30 * HOUR) / 1000);
  const session = sessionToday([entry(yesterday)], Date.now() - 6 * HOUR);
  assert.equal(session.todayRecord, undefined, 'no record should be claimed for today');
  assert.equal(session.lastMatchAt, yesterday * 1000);
});

test('sessionToday carries lastMatchAt alongside the day\'s stats', () => {
  const since = Date.now() - 6 * HOUR;
  const recent = Math.floor((Date.now() - 20 * MIN) / 1000);
  const session = sessionToday([entry(recent), entry(Math.floor(since / 1000) - 99)], since);
  assert.equal(session.matches, '1', 'only the match after `since` counts for today');
  assert.equal(session.lastMatchAt, recent * 1000,
    'freshness is the newest match overall, not the newest one from today');
});

test('ageLabel formats the age the way a viewer reads it', () => {
  const now = 1_700_000_000_000;
  assert.equal(ageLabel(now - 30_000, now), 'just now');
  assert.equal(ageLabel(now - 20 * MIN, now), '20m ago');
  assert.equal(ageLabel(now - 59 * MIN, now), '59m ago');
  assert.equal(ageLabel(now - 3 * HOUR, now), '3h ago');
  assert.equal(ageLabel(now - 23 * HOUR, now), '23h ago');
  assert.equal(ageLabel(now - 50 * HOUR, now), '2d ago');
});

test('ageLabel is empty rather than wrong when it has nothing to date', () => {
  const now = 1_700_000_000_000;
  for (const bad of [null, undefined, 0, -1, 'yesterday', NaN]) {
    assert.equal(ageLabel(bad, now), '', `unexpected label for ${String(bad)}`);
  }
  // A document generated on a machine whose clock is ahead must not print
  // "-4m ago" on the broadcast.
  assert.equal(ageLabel(now + 4 * MIN, now), '');
});

test('the age climbs as a frozen document sits there', () => {
  // This is the second thing the signal buys: if the proxy stops updating, the
  // board does not sit still looking live, because the label is recomputed from
  // a timestamp on every render rather than printed once by the proxy.
  const at = 1_700_000_000_000;
  assert.equal(ageLabel(at, at + 10 * MIN), '10m ago');
  assert.equal(ageLabel(at, at + 2 * HOUR), '2h ago');
});
