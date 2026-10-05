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
export const GAME_MODES = { normal: 1, brawl: 4 };
const COMPETITIVE_MATCH_MODES = new Set([1, 4]);

/** Competitive play in one specific game mode. */
export function isMode(entry, gameMode) {
  return entry?.game_mode === gameMode
      && COMPETITIVE_MATCH_MODES.has(entry?.match_mode);
}

/** Normal 6v6. Unchanged meaning — everything downstream still defaults to it. */
export function isCountable(entry) {
  return isMode(entry, GAME_MODES.normal);
}

/**
 * Street Brawl. A separate game with its own scoring, so its matches are
 * tracked apart rather than folded into the season record: confirmed by
 * observation, brawl entries carry brawl_score and brawl_avg_round_time_s
 * (69 and 73 of 74 non-zero) where normal entries carry neither (0 of 166).
 */
export function isBrawl(entry) {
  return isMode(entry, GAME_MODES.brawl);
}

/** An entry only counts toward W/L if both sides of the comparison exist. */
/** Builds an is-scored test for one mode. */
export const scoredBy = countable => entry =>
  countable(entry)
  && Number.isInteger(entry?.player_team)
  && Number.isInteger(entry?.match_result);

export const isScored = scoredBy(isCountable);

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
/** The comparison itself, for callers that have already screened the entry. */
const won = entry => entry.player_team === entry.match_result;

export function isWin(entry) {
  return isScored(entry) && won(entry);
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

/**
 * When the newest match we can see actually started, in epoch ms, or null if
 * the history is empty.
 *
 * This is the project's only honest freshness signal. `stale` on the state
 * document means the proxy could not reach the API on one tick — transient,
 * self-healing, and deliberately not drawn (see fallbackState). It says nothing
 * about the case that actually bites: the API answering promptly with history
 * that is hours behind, because an account not friended to a deadlock-api bot
 * only ever gets the stored ClickHouse copy. There `stale` is false and every
 * number is quietly old. The age of the newest match is what reveals that, and
 * it is a timestamp rather than a formatted string so the overlay recomputes it
 * on every render — which also makes a frozen document visibly age on screen.
 */
export function newestStart(entries) {
  let best = null;
  for (const e of entries ?? []) {
    const t = e?.start_time;
    if (typeof t === 'number' && t > 0 && (best === null || t > best)) best = t;
  }
  return best === null ? null : best * 1000;
}

/** Newest-first copy. The API's order is not contractual, so sort explicitly. */
function recent(entries) {
  return (entries ?? []).slice().sort(byNewest);
}

export function seasonRecord(entries, scored = isScored) {
  let wins = 0, losses = 0;
  for (const en of entries ?? []) {
    if (!scored(en)) continue;
    if (won(en)) wins++; else losses++;
  }
  return { wins, losses, text: `${wins}-${losses}` };
}

/** All-time count over countable play. See the base-rate note in the preamble. */
export function abandonCount(entries, countable = isCountable) {
  let n = 0;
  for (const en of entries ?? []) if (countable(en) && isAbandon(en)) n++;
  return n;
}

/**
 * The FORM column: the last n scored results, newest first, as 'W'/'L'.
 * Short histories are padded with spaces so the string is always exactly n
 * characters — the chiron's Form group is a fixed width and must not be fed a short
 * string.
 */
export function form(entries, n = 11, scored = isScored) {
  const chars = recent(entries)
    .filter(scored)
    .slice(0, n)
    .map(en => (won(en) ? 'W' : 'L'));
  return chars.join('').padEnd(n, ' ');
}

/** Current run of identical results, newest-first. */
export function streak(entries, isScoredFn = isScored) {
  const scored = recent(entries).filter(isScoredFn);
  if (!scored.length) return { kind: null, n: 0 };
  const kind = won(scored[0]) ? 'W' : 'L';
  let n = 0;
  for (const en of scored) {
    if ((won(en) ? 'W' : 'L') !== kind) break;
    n++;
  }
  return { kind, n };
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
// Countable-only: a Street Brawl round lasts minutes and has its own net-worth
// scale, so including one would skew every average in the chiron.
const nums = (entries, field, countable = isCountable) =>
  (entries ?? []).filter(countable).map(en => en?.[field]).filter(v => typeof v === 'number');

export function averages(entries, countable = isCountable) {
  const kills = nums(entries, 'player_kills', countable);
  const deaths = nums(entries, 'player_deaths', countable);
  const totalDeaths = deaths.reduce((a, b) => a + b, 0);
  return {
    // guard the zero-death case: a player who has never died is 'inf', not NaN
    kd: totalDeaths === 0
      ? (kills.length ? Infinity : 0)
      : kills.reduce((a, b) => a + b, 0) / totalDeaths,
    netWorth: mean(nums(entries, 'net_worth', countable)),
    lastHits: mean(nums(entries, 'last_hits', countable)),
    denies: mean(nums(entries, 'denies', countable)),
    matchLen: mean(nums(entries, 'match_duration_s', countable))
  };
}

/** Everything the chiron's turns need, from one history array. */
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
export function sessionToday(entries, since, countable = isCountable) {
  const pool = (entries ?? []).filter(countable);
  const todays = pool
    .filter(e => typeof e?.start_time === 'number' && e.start_time * 1000 >= since);
  // Carried even on a day with no matches: an empty session block is exactly
  // when the streamer most wants to know whether that is true or merely unseen.
  const fresh = { lastMatchAt: newestStart(pool) };
  if (!todays.length) return fresh;

  const scored = todays.filter(scoredBy(countable));
  const wins = scored.filter(won).length;
  const losses = scored.length - wins;
  const kills = todays.reduce((a, e) => a + (e.player_kills ?? 0), 0);
  const deaths = todays.reduce((a, e) => a + (e.player_deaths ?? 0), 0);
  // ranked_delta is the per-match rank movement; summing the day gives progress.
  const delta = todays.reduce((a, e) => a + (e.ranked_delta ?? 0), 0);

  return {
    ...fresh,
    todayRecord: `${wins}-${losses}`,
    winRateToday: scored.length ? `${Math.round((wins / scored.length) * 100)}%` : '',
    kd: deaths ? (kills / deaths).toFixed(1) : (kills ? '∞' : '0.0'),
    matches: String(todays.length),
    rankProgress: delta ? (delta > 0 ? `+${delta}` : String(delta)) : ''
  };
}

/** One mode's block of statistics. */
export function deriveMode(entries, countable) {
  const scored = scoredBy(countable);
  const pool = (entries ?? []).filter(countable);
  return {
    form: form(pool, 11, scored),
    season: seasonRecord(pool, scored),
    abandons: abandonCount(pool, countable),
    streak: streak(pool, scored),
    averages: averages(pool, countable),
    matches: pool.filter(scored).length
  };
}

/**
 * Which mode this player has most recently played, so the overlay can show the
 * stats that match what they are actually doing rather than a stale headline
 * from a mode they left weeks ago. Falls back to normal when there is nothing
 * to go on.
 */
export function lastPlayedMode(entries) {
  let best = null;
  for (const en of entries ?? []) {
    if (!isCountable(en) && !isBrawl(en)) continue;
    if (!best || (en.start_time ?? 0) > (best.start_time ?? 0)) best = en;
  }
  return best && isBrawl(best) ? 'brawl' : 'normal';
}

/**
 * Which hero the player most recently picked, by id.
 *
 * The chiron shows a hero icon, and `hero_id` on the state document only has a
 * value during a match — which, with no live roster available, is almost never.
 * Without this the Hero turn would sit on a dash permanently. Mode-agnostic on
 * purpose: the last hero you played is the last hero you played, whichever
 * queue it was in.
 */
export function lastHero(entries) {
  let best = null;
  for (const en of entries ?? []) {
    if (!isCountable(en) && !isBrawl(en)) continue;
    if (!Number.isInteger(en.hero_id)) continue;
    if (!best || (en.start_time ?? 0) > (best.start_time ?? 0)) best = en;
  }
  return best ? best.hero_id : null;
}

/**
 * Normal-mode stats stay at the top level so every existing consumer is
 * untouched; brawl rides alongside. Both are always present, so the UI can
 * switch between them without another fetch.
 */
export function derivePlayer(entries) {
  return {
    ...deriveMode(entries, isCountable),
    brawl: deriveMode(entries, isBrawl),
    lastMode: lastPlayedMode(entries),
    lastHero: lastHero(entries)
  };
}
