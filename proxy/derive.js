/**
 * Derives per-player statistics from /v1/players/{id}/match-history.
 * Every function here is pure. See spec section 3.6.
 */

/**
 * Normal-mode competitive play only — an ALLOWLIST.
 *
 * game_mode 1 = Normal, 4 = Street Brawl (a round-based mode with its own
 * scoring; two such entries in the recorded fixture carry real brawl scores).
 * match_mode 1 = Unranked, 4 = Ranked; the enum also holds private_lobby,
 * coop_bot, server_test, tutorial and hero_labs, whose numbers are not
 * confirmed by observation.
 *
 * Allowlisting means an unrecognised mode is excluded rather than counted. That
 * is the safe direction: a mystery mode cannot inflate a win rate, and bot
 * games would.
 */
const NORMAL_GAME_MODE = 1;
const COMPETITIVE_MATCH_MODES = new Set([1, 4]);

export function isCountable(entry) {
  return entry?.game_mode === NORMAL_GAME_MODE
      && COMPETITIVE_MATCH_MODES.has(entry?.match_mode);
}

/** An entry only counts toward W/L if both sides of the comparison exist. */
export function isScored(entry) {
  return isCountable(entry)
      && Number.isInteger(entry?.player_team)
      && Number.isInteger(entry?.match_result);
}

/**
 * Win iff the player's team is the winning team.
 *
 * Do NOT substitute `player_match_outcome`. It looks tempting because on recent
 * matches `outcome === 1` tracks this exactly — but it is unset (0) on 91% of a
 * 4,348-entry history, because older matches predate the field, and a season
 * record spans both eras. It is also not boolean where it IS set: the recorded
 * fixture contains outcome values 3 and 5 alongside 0/1/2, with undocumented
 * meanings. Comparing team to result needs no enum knowledge and holds
 * everywhere. Cross-tabs over both a 4,348-entry and a 63-entry sample agree:
 * where the two are equal the outcome is never 2, where they differ never 1.
 */
export function isWin(entry) {
  return isScored(entry) && entry.player_team === entry.match_result;
}

/**
 * abandoned_time_s uses 0 as "did not abandon", NOT null. Live distribution
 * over 4,348 entries: null 3,270, zero 1,074, non-zero 4. Treating non-null
 * as an abandon would over-report by ~270x.
 */
export function isAbandon(entry) {
  return typeof entry?.abandoned_time_s === 'number' && entry.abandoned_time_s > 0;
}

const byNewest = (a, b) => (b.start_time ?? 0) - (a.start_time ?? 0);

/** Newest-first copy. The API's order is not contractual, so sort explicitly. */
function recent(entries) {
  return (entries ?? []).slice().sort(byNewest);
}

export function seasonRecord(entries) {
  let wins = 0, losses = 0;
  for (const en of entries ?? []) {
    if (!isScored(en)) continue;
    if (isWin(en)) wins++; else losses++;
  }
  return { wins, losses, text: `${wins}-${losses}` };
}

/** All-time count over countable play. See the base-rate note in the preamble. */
export function abandonCount(entries) {
  let n = 0;
  for (const en of entries ?? []) if (isCountable(en) && isAbandon(en)) n++;
  return n;
}

/**
 * The FORM column: the last n scored results, newest first, as 'W'/'L'.
 * Short histories are padded with spaces so the string is always exactly n
 * characters — the board's cell count is fixed and must not be fed a short
 * string.
 */
export function form(entries, n = 11) {
  const chars = recent(entries)
    .filter(isScored)
    .slice(0, n)
    .map(en => (isWin(en) ? 'W' : 'L'));
  return chars.join('').padEnd(n, ' ');
}

/** Current run of identical results, newest-first. */
export function streak(entries) {
  const scored = recent(entries).filter(isScored);
  if (!scored.length) return { kind: null, n: 0 };
  const kind = isWin(scored[0]) ? 'W' : 'L';
  let n = 0;
  for (const en of scored) {
    if ((isWin(en) ? 'W' : 'L') !== kind) break;
    n++;
  }
  return { kind, n };
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
// Countable-only: a Street Brawl round lasts minutes and has its own net-worth
// scale, so including one would skew every average on the board.
const nums = (entries, field) =>
  (entries ?? []).filter(isCountable).map(en => en?.[field]).filter(v => typeof v === 'number');

export function averages(entries) {
  const kills = nums(entries, 'player_kills');
  const deaths = nums(entries, 'player_deaths');
  const totalDeaths = deaths.reduce((a, b) => a + b, 0);
  return {
    // guard the zero-death case: a player who has never died is 'inf', not NaN
    kd: totalDeaths === 0
      ? (kills.length ? Infinity : 0)
      : kills.reduce((a, b) => a + b, 0) / totalDeaths,
    netWorth: mean(nums(entries, 'net_worth')),
    lastHits: mean(nums(entries, 'last_hits')),
    denies: mean(nums(entries, 'denies')),
    matchLen: mean(nums(entries, 'match_duration_s'))
  };
}

/** Everything the board and the free stat tier need, from one history array. */
/**
 * Everything the chiron's Session turn needs, derived from the match history we
 * already fetch.
 *
 * The /commands/resolve endpoint was built for this and is the obvious source,
 * but it serves text/plain (not the JSON our client assumes) and returns an
 * empty body for every query we tried, including a literal with no variable in
 * it. History carries `start_time` per match, so "today" is ours to compute and
 * needs no second upstream.
 *
 * `since` is the local midnight boundary, passed in so the caller owns the
 * clock and tests are not at the mercy of the machine's timezone.
 */
export function sessionToday(entries, since) {
  const todays = (entries ?? []).filter(isCountable)
    .filter(e => typeof e?.start_time === 'number' && e.start_time * 1000 >= since);
  if (!todays.length) return {};

  const scored = todays.filter(isScored);
  const wins = scored.filter(isWin).length;
  const losses = scored.length - wins;
  const kills = todays.reduce((a, e) => a + (e.player_kills ?? 0), 0);
  const deaths = todays.reduce((a, e) => a + (e.player_deaths ?? 0), 0);
  // ranked_delta is the per-match rank movement; summing the day gives progress.
  const delta = todays.reduce((a, e) => a + (e.ranked_delta ?? 0), 0);

  return {
    todayRecord: `${wins}-${losses}`,
    winRateToday: scored.length ? `${Math.round((wins / scored.length) * 100)}%` : '',
    kd: deaths ? (kills / deaths).toFixed(1) : (kills ? '∞' : '0.0'),
    matches: String(todays.length),
    rankProgress: delta ? (delta > 0 ? `+${delta}` : String(delta)) : ''
  };
}

export function derivePlayer(entries) {
  const scored = (entries ?? []).filter(isScored);
  return {
    form: form(entries, 11),
    season: seasonRecord(entries),
    abandons: abandonCount(entries),
    streak: streak(entries),
    averages: averages(entries),
    matches: scored.length
  };
}
