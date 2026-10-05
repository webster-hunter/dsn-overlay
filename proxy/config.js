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
export const MATCH_TTL_MS = 6 * 60_000; // roster is immutable after start
export const CONTEXT_TTL_MS = 60 * 60_000;
export const HISTORY_CONCURRENCY = 3;   // 12 x 2.5MB; do not fetch in parallel
