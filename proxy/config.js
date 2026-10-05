/** Operator identity and tunables. This is the only file a second user edits. */
import { loadEnv } from './env.js';
import { toAccountId } from './steamid.js';

// Read .env from the repo root before anything below reads process.env.
// Resolved against this module, not the working directory, so the proxy picks
// it up however it is launched. A real environment variable still wins.
loadEnv(new URL('../.env', import.meta.url));

// Any Steam identifier: the Friend Code from Steam's own UI, a 17-digit
// SteamID64 from a profile URL, [U:1:...] or legacy STEAM_0:... — they all
// normalise to the 32-bit account id the Deadlock API wants. Unrecognised
// input resolves to 0, which keeps the proxy idle rather than guessing.
export const ACCOUNT_ID = toAccountId(process.env.DSN_ACCOUNT_ID);

/**
 * What the top bar shows. Set in .env so there is one place a user edits.
 * Both are optional — the bar keeps its height either way, because that height
 * is what makes the gameplay area 16:9.
 */
export const STREAMER = Object.fromEntries(Object.entries({
  name: process.env.DSN_STREAMER_NAME ?? '',
  tagline: process.env.DSN_STREAMER_TAGLINE ?? ''
}).filter(([, v]) => v.trim() !== ''));

/**
 * PENDING DAY-ONE VERIFICATION — spec section 4.2.
 *
 * Valve's CSS names its tokens team1_color / team2_color (1-indexed) while the
 * API returns Team0 / Team1 and net_worth_team_0 (0-indexed). Convention makes
 * team1_color the first team, i.e. Team0 = amber. That is convention, not
 * documentation. Confirm against one real match, then delete this comment.
 */
export const TEAM0_IS_AMBER = true;

/** Faction names are bound to COLOUR, not to team index, so a wrong index
 *  mapping is a one-line fix rather than a mislabelled broadcast. */
export const FACTIONS = { amber: 'Hidden King', sapphire: 'Archmother' };

export const POLL_MS = 15_000;          // match detection

/**
 * Longer than any plausible match, deliberately.
 *
 * NOTHING in the state document changes while a match runs: the roster is
 * fixed at start, names and ranks only move between matches, and the current
 * match is not in anyone's history yet. So a mid-match expiry buys no fresh
 * data and costs a full 17-call, 18.5 MB re-assembly. At the original 6 minutes
 * a 35-minute match re-assembled five or six times — roughly 100 calls and
 * 111 MB for data that could not have changed, against a stated constraint of
 * "fetch once per match, never poll".
 *
 * The TTL gates REUSE, not memory: makeCache has get/set/stale and no eviction
 * path, so an expired entry is re-fetched but never removed. The Map grows one
 * small entry per match_id for the process lifetime — measured at roughly
 * 300 KB across a 20-match stream, which is why no eviction is warranted.
 * Match END is detected by the 15s poll of /matches/active, not by this
 * expiring.
 */
export const MATCH_TTL_MS = 90 * 60_000;
export const CONTEXT_TTL_MS = 60 * 60_000;
export const HISTORY_CONCURRENCY = 3;   // 12 x 2.5MB; do not fetch in parallel

/**
 * Safety net for the operator's own history while idle.
 *
 * The normal triggers are the CONTEXT_TTL_MS baseline and a drop the moment a
 * match ends. The latter needs the proxy to actually WITNESS the match, and the
 * active-match feed is not guaranteed to report one — upstream gaps are real
 * and observed. Without a net, a missed match leaves stats stale for the full
 * hour.
 *
 * 15 minutes is at most 4 fetches an hour. deadlock-api allows bot-friended
 * accounts 10 req/h on plain match-history (and only 1 req/h with
 * force_refetch, which is why this project never sets it), so this stays
 * comfortably inside the limit.
 */
export const SELF_RECHECK_MS = 15 * 60_000;

/**
 * Deadlock's own console log, the only way to know the operator is in a match.
 *
 * deadlock-api's single live source is /v1/matches/active, which its own
 * documentation describes as the in-game watch tab, "limited to the top 200
 * matches" — so an ordinary account's match is never in it, and no endpoint
 * maps a player to their current match. The game knows, and the proxy runs on
 * the same machine, so the log is the route.
 *
 * Requires `-condebug` in Deadlock's Steam launch options; without it the game
 * writes no log and this path simply will not exist, which is handled.
 */
export const DEADLOCK_LOG = process.env.DSN_DEADLOCK_LOG
  ?? 'C:/Program Files (x86)/Steam/steamapps/common/Deadlock/game/citadel/console.log';
