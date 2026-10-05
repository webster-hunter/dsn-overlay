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
/** Twitch channel whose chat fills the right rail. Empty renders a placeholder. */
export const TWITCH_CHANNEL = (process.env.DSN_TWITCH_CHANNEL ?? '').trim();

export const STREAMER = Object.fromEntries(Object.entries({
  name: process.env.DSN_STREAMER_NAME ?? '',
  tagline: process.env.DSN_STREAMER_TAGLINE ?? '',
  twitch: TWITCH_CHANNEL
}).filter(([, v]) => v.trim() !== ''));

export const POLL_MS = 15_000;          // match detection

/**
 * How long the operator's own history stays reusable.
 *
 * It is one ~2.5 MB call, and almost nothing in it changes between matches —
 * season record, form, averages and the hero pool all move only when a game
 * finishes. So idling costs one fetch an hour rather than one per 15s poll, and
 * the triggers that actually matter are elsewhere: the cache is dropped the
 * moment a match ends, with SELF_RECHECK_MS as the net for a match neither
 * source reported.
 *
 * The TTL gates REUSE, not memory: makeCache has get/set/stale and no eviction,
 * so an expired entry is re-fetched but never removed. There is one entry.
 */
export const CONTEXT_TTL_MS = 60 * 60_000;

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
