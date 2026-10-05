import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isCountable, isScored, isWin, isAbandon, form, seasonRecord,
  abandonCount, streak, averages, derivePlayer, sessionToday, lastPlayedMode } from '../proxy/derive.js';

const REAL = JSON.parse(readFileSync('fixtures/match-history.sample.json', 'utf8'));

// Minimal synthetic entry; override what a test cares about.
// game_mode 1 (Normal) + match_mode 4 (Ranked) make it countable by default —
// without them isCountable rejects the entry and every aggregate reads zero.
const e = (over = {}) => ({
  match_id: 1, start_time: 1000, player_team: 0, match_result: 0,
  game_mode: 1, match_mode: 4,
  player_kills: 5, player_deaths: 5, player_assists: 5,
  net_worth: 50000, last_hits: 150, denies: 10,
  match_duration_s: 1800, hero_id: 1, abandoned_time_s: null, ...over
});

test('a win is player_team === match_result', () => {
  assert.equal(isWin(e({ player_team: 0, match_result: 0 })), true);
  assert.equal(isWin(e({ player_team: 1, match_result: 1 })), true);
  assert.equal(isWin(e({ player_team: 0, match_result: 1 })), false);
  assert.equal(isWin(e({ player_team: 1, match_result: 0 })), false);
});

test('Street Brawl is excluded — it is a different mode with its own scoring', () => {
  const brawl = e({ game_mode: 4, match_mode: 1, brawl_score_team0: 2 });
  assert.equal(isCountable(brawl), false);
  assert.equal(isScored(brawl), false, 'must not reach the win/loss comparison');

  const mixed = [
    e({ match_id: 1, player_team: 0, match_result: 0 }),                 // normal W
    e({ match_id: 2, player_team: 0, match_result: 1 }),                 // normal L
    e({ match_id: 3, game_mode: 4, match_mode: 1, player_team: 0, match_result: 1 })
  ];
  const rec = seasonRecord(mixed);
  assert.deepEqual({ wins: rec.wins, losses: rec.losses }, { wins: 1, losses: 1 },
    'the brawl entry must not appear in the record');
});

test('unranked normal play DOES count', () => {
  assert.equal(isCountable(e({ match_mode: 1 })), true, 'match_mode 1 is Unranked');
  assert.equal(isCountable(e({ match_mode: 4 })), true, 'match_mode 4 is Ranked');
});

test('an unrecognised mode is excluded, not counted — allowlist not blocklist', () => {
  // The enum holds private_lobby, coop_bot, server_test, tutorial and hero_labs
  // whose numbers are unconfirmed. Excluding by default means a bot-game mode
  // cannot silently inflate a win rate.
  for (const mm of [0, 2, 3, 5, 6, 7, 99, null, undefined]) {
    assert.equal(isCountable(e({ match_mode: mm })), false,
      `match_mode ${mm} is unconfirmed and must not count`);
  }
  for (const gm of [0, 2, 3, 4, 99, null, undefined]) {
    assert.equal(isCountable(e({ game_mode: gm })), false,
      `game_mode ${gm} is not Normal and must not count`);
  }
});

test('averages exclude non-countable entries', () => {
  // A brawl round is short and has its own net-worth scale; one would skew
  // every average on the board.
  const rows = [
    e({ net_worth: 50000, match_duration_s: 1800 }),
    e({ game_mode: 4, match_mode: 1, net_worth: 5, match_duration_s: 60 })
  ];
  assert.equal(averages(rows).netWorth, 50000, 'the brawl entry must not drag the mean');
  assert.equal(averages(rows).matchLen, 1800);
});

test('player_match_outcome is never consulted, even when it contradicts', () => {
  // An entry whose outcome field disagrees with the team/result pair. The
  // derivation must ignore it: outcome is unset on 91% of a long history and
  // is not a boolean where it is set.
  const misleading = e({ player_team: 0, match_result: 0, player_match_outcome: 2 });
  assert.equal(isWin(misleading), true, 'must trust player_team === match_result');

  const alsoMisleading = e({ player_team: 0, match_result: 1, player_match_outcome: 1 });
  assert.equal(isWin(alsoMisleading), false, 'a 1 must not override a team/result mismatch');
});

test('the real fixture shows why outcome cannot be treated as a boolean', () => {
  const outcomes = new Set(REAL.map(r => r.player_match_outcome));
  // Observed in fixtures/match-history.sample.json: 0, 1, 2, 3 and 5. Anyone
  // tempted to "simplify" isWin to `outcome === 1` should see this fail to be
  // a two-valued field first.
  const beyondBoolean = [...outcomes].filter(v => v !== undefined && v > 2);
  assert.ok(beyondBoolean.length > 0,
    `expected outcome values above 2; got ${[...outcomes].join(',')}`);
});

test('unscored and in-progress entries are excluded from W/L', () => {
  assert.equal(isScored(e({ match_result: null })), false);
  assert.equal(isScored(e({ player_team: null })), false);
  assert.equal(isScored(e({ match_result: undefined })), false);
  assert.equal(isWin(e({ match_result: null })), false, 'must not count as a win');

  const mixed = [
    e({ match_id: 1, player_team: 0, match_result: 0 }),   // W
    e({ match_id: 2, player_team: 0, match_result: null }), // unscored
    e({ match_id: 3, player_team: 0, match_result: 1 })     // L
  ];
  const rec = seasonRecord(mixed);
  assert.deepEqual({ wins: rec.wins, losses: rec.losses }, { wins: 1, losses: 1 },
    'the unscored entry must be dropped, not counted as a loss');
});

test('abandon detection uses > 0, not non-null', () => {
  assert.equal(isAbandon(e({ abandoned_time_s: null })), false);
  assert.equal(isAbandon(e({ abandoned_time_s: 0 })), false, '0 means did not abandon');
  assert.equal(isAbandon(e({ abandoned_time_s: 483 })), true);

  const rows = [
    e({ abandoned_time_s: null }), e({ abandoned_time_s: 0 }),
    e({ abandoned_time_s: 0 }), e({ abandoned_time_s: 256 })
  ];
  assert.equal(abandonCount(rows), 1, 'three non-abandons, one abandon');
});

test('the real fixture reports a plausible abandon count', () => {
  const n = abandonCount(REAL);
  assert.ok(n >= 1, 'fixture retains at least one abandon');
  assert.ok(n < REAL.length * 0.1,
    `${n} of ${REAL.length} is implausibly high — the 0-sentinel bug is back`);
});

test('form is always exactly n characters', () => {
  assert.equal(form(REAL, 11).length, 11);
  assert.equal(form([], 11).length, 11);
  assert.equal(form(null, 11).length, 11);
});

test('a brand-new account with 3 matches pads rather than breaking', () => {
  const three = [
    e({ match_id: 1, start_time: 300, player_team: 0, match_result: 0 }),
    e({ match_id: 2, start_time: 200, player_team: 0, match_result: 1 }),
    e({ match_id: 3, start_time: 100, player_team: 0, match_result: 0 })
  ];
  const f = form(three, 11);
  assert.equal(f.length, 11);
  assert.equal(f, 'WLW        ', 'results left, blanks right, no repeats');
  assert.equal(f.trim().length, 3, 'exactly three results, not eleven');
});

test('form is newest-first regardless of input order', () => {
  const shuffled = [
    e({ match_id: 1, start_time: 100, player_team: 0, match_result: 1 }), // oldest, L
    e({ match_id: 2, start_time: 300, player_team: 0, match_result: 0 }), // newest, W
    e({ match_id: 3, start_time: 200, player_team: 0, match_result: 1 })  // middle, L
  ];
  assert.equal(form(shuffled, 3), 'WLL');
});

test('an all-unscored history yields a blank form, not an exception', () => {
  const none = [e({ match_result: null }), e({ match_result: null })];
  assert.equal(form(none, 11), '           ');
  assert.equal(form(none, 11).length, 11);
});

test('streak counts the current run only', () => {
  const rows = [
    e({ match_id: 1, start_time: 500, player_team: 0, match_result: 0 }),
    e({ match_id: 2, start_time: 400, player_team: 0, match_result: 0 }),
    e({ match_id: 3, start_time: 300, player_team: 0, match_result: 1 }),
    e({ match_id: 4, start_time: 200, player_team: 0, match_result: 0 })
  ];
  assert.deepEqual(streak(rows), { kind: 'W', n: 2 });
  assert.deepEqual(streak([]), { kind: null, n: 0 });
});

test('a player who has never died gives Infinity, not NaN', () => {
  const flawless = [e({ player_kills: 7, player_deaths: 0 })];
  assert.equal(averages(flawless).kd, Infinity);
  assert.ok(!Number.isNaN(averages([]).kd));
});

test('derivePlayer on the real fixture is internally consistent', () => {
  const d = derivePlayer(REAL);
  assert.equal(d.form.length, 11);
  assert.equal(d.season.wins + d.season.losses, d.matches);
  assert.ok(d.season.text.includes('-'));
  assert.ok(d.season.text.length <= 11, 'season must fit the cell budget');
  assert.ok(d.abandons >= 0);
  assert.ok(d.averages.netWorth > 0);
});

test('sessionToday counts only matches started since the boundary', () => {
  const mk = (hoursAgo, kills, deaths, result, delta) => ({
    start_time: Math.floor((Date.now() - hoursAgo * 3600e3) / 1000),
    game_mode: 1, match_mode: 1, player_kills: kills, player_deaths: deaths,
    match_result: result, player_team: 0, ranked_delta: delta,
    player_match_outcome: 0
  });
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  // two today (one win, one loss), one well before the boundary
  const out = sessionToday([mk(1, 10, 5, 0, 12), mk(2, 4, 8, 1, -6), mk(40, 9, 1, 0, 30)],
                           midnight.getTime());
  assert.equal(out.todayRecord, '1-1');
  assert.equal(out.winRateToday, '50%');
  assert.equal(out.matches, '2');          // the 40h-old match must not count
  assert.equal(out.kd, '1.1');             // (10+4)/(5+8)
  assert.equal(out.rankProgress, '+6');    // 12 + -6, and signed
});

test('a day with no matches yields {} so the turn shows dashes, not zeroes', () => {
  // Zeroes would assert "you went 0-0 today"; absent data must read as absent.
  const old = { start_time: Math.floor((Date.now() - 40 * 3600e3) / 1000),
                game_mode: 1, match_mode: 1, player_team: 0, match_result: 0 };
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  assert.deepEqual(sessionToday([old], midnight.getTime()), {});
  assert.deepEqual(sessionToday([], midnight.getTime()), {});
  assert.deepEqual(sessionToday(null, midnight.getTime()), {});
});

test('normal and brawl are derived separately from one history', () => {
  const mk = (gameMode, result, t) => ({
    game_mode: gameMode, match_mode: 1, player_team: 0, match_result: result,
    start_time: t, player_kills: 4, player_deaths: 2, net_worth: 1000
  });
  // two normal wins, one brawl loss
  const hist = [mk(1, 0, 300), mk(1, 0, 200), mk(4, 1, 100)];
  const d = derivePlayer(hist);
  assert.equal(d.season.text, '2-0', 'normal stays at the top level');
  assert.equal(d.brawl.season.text, '0-1', 'brawl is tracked apart');
  assert.equal(d.matches, 2);
  assert.equal(d.brawl.matches, 1);
});

test('lastPlayedMode follows the most recent countable match, not the array order', () => {
  const mk = (gameMode, t) => ({ game_mode: gameMode, match_mode: 1, start_time: t,
                                 player_team: 0, match_result: 0 });
  // deliberately out of order: the newest entry is the brawl one
  assert.equal(lastPlayedMode([mk(1, 100), mk(4, 900), mk(1, 500)]), 'brawl');
  assert.equal(lastPlayedMode([mk(4, 100), mk(1, 900)]), 'normal');
  assert.equal(lastPlayedMode([]), 'normal', 'nothing to go on falls back to normal');
  // an uncountable mode must not win the comparison
  assert.equal(lastPlayedMode([mk(1, 100), { game_mode: 7, match_mode: 1, start_time: 999 }]), 'normal');
});
