/** Operator identity and tunables. This is the only file a second user edits. */

// SteamID3. Find yours at https://steamid.io — the "steamID3" value's numeric part.
export const ACCOUNT_ID = Number(process.env.DSN_ACCOUNT_ID ?? 0);

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
