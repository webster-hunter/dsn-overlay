import { rankLabel } from './rank.js';
import { STREAMER } from './config.js';

const PLACEHOLDER_NAME = 'UNKNOWN';

/** Shape-compatible zero value, so a player with no history still renders. */
const EMPTY_DERIVED = {
  form: ' '.repeat(11),
  season: { wins: 0, losses: 0, text: '0-0' },
  abandons: 0,
  streak: { kind: null, n: 0 },
  averages: { kd: 0, netWorth: 0, lastHits: 0, denies: 0, matchLen: 0 },
  matches: 0,
  heroPool: []
};

function indexBy(rows, key) {
  const m = new Map();
  if (!Array.isArray(rows)) return m;      // a string or object upstream must not throw
  for (const r of rows) {
    if (r && typeof r === 'object' && key in r) m.set(r[key], r);
  }
  return m;
}

const k = n => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

/** Seconds as m:ss. A match length of 1,812s reads as 30:12, not as 1812. */
const clock = secs => {
  const n = Math.round(secs ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

function playerRow(p, steamById, rankById, derived, operatorId, mode = 'normal') {
  const prof = steamById.get(p.account_id);
  const rk = rankById.get(p.account_id);
  // Pre-derived by the caller so each 2.5MB history is released before the
  // next is fetched. EMPTY_DERIVED keeps a missing entry renderable.
  const all = derived.get(p.account_id) ?? EMPTY_DERIVED;
  // Normal lives at the top level, brawl alongside it. Showing the mode the
  // player is actually in beats a stale headline from one they have left.
  const d = mode === 'brawl' ? (all.brawl ?? EMPTY_DERIVED) : all;
  const kd = d.averages.kd;
  const ranked = (rk?.rank ?? 0) > 0;
  return {
    accountId: p.account_id,
    // A private profile or an omitted batch row must not blank the chiron.
    name: prof?.personaname?.trim() || PLACEHOLDER_NAME,
    heroId: p.hero_id ?? null,
    // Kept separate from heroId rather than folded into it: one is the hero
    // being played right now, the pool is who they play. The chiron prefers
    // the live value and rotates the pool otherwise, and the document does not
    // blur which it has.
    heroPool: all.heroPool ?? [],
    isSelf: operatorId > 0 && p.account_id === operatorId,
    form: d.form,
    season: d.season.text,
    abandons: String(d.abandons),
    // A rank row exists for everyone, but the API fills it with
    // rank 0 / subrank 0 / last_match null when there is no rank yet. Tier 0 is
    // a real name ("Obscurus"), so rendering the row as-is labels an UNRANKED
    // player as the lowest rank in the game. Real ranks carry subranks 1-6, so
    // rank 0 means no data. Understating a true tier-0 player is a far smaller
    // error than telling a broadcast its streamer is Obscurus when they are
    // simply unranked.
    rank: ranked ? rankLabel(rk.rank, rk.subrank) : 'UNRANKED',
    kd: Number.isFinite(kd) ? kd.toFixed(1) : '∞',
    streak: d.streak.kind ? `${d.streak.kind}${d.streak.n}` : '0',
    netWorth: k(d.averages.netWorth),
    lastHits: String(Math.round(d.averages.lastHits)),
    denies: mode === 'brawl' ? '-' : String(Math.round(d.averages.denies)),
    matchLen: clock(d.averages.matchLen),
    matches: String(d.matches),
    mode
  };
}

/**
 * The streamer's own row, built from their history alone — no match required.
 *
 * Four of the chiron's five turns are about the operator, not the match, so
 * without this they sit on dashes whenever no game is running: in queue,
 * between matches, and while setting up a scene. The data is reachable the
 * whole time; nothing was asking for it.
 *
 * Reuses playerRow so the row is produced by the same tested path as every
 * other row. `hero_id` is null because there is no match to have picked one.
 */
export function operatorRow({ accountId, steam = [], ranks = [], derived = new Map(), mode }) {
  if (!(accountId > 0)) return null;
  // Idle, there is no match to take the mode from, so follow whatever they
  // played last — otherwise someone three weeks into Street Brawl sees a
  // September headline with nothing saying so.
  const resolved = mode ?? derived.get(accountId)?.lastMode ?? 'normal';
  return playerRow(
    { account_id: accountId, hero_id: null },
    indexBy(steam, 'account_id'),
    indexBy(ranks, 'account_id'),
    derived,
    accountId,
    resolved
  );
}

/**
 * The state document. One shape, always — every field present whatever happened
 * upstream, so the overlay is a pure render of it and never has to branch on
 * absence.
 *
 * There is no roster here. `teams` and `factions` were removed with the Matchup
 * turn: the API cannot report the players in a live match, nothing on screen
 * showed them, and keeping the array meant fetching twelve Steam profiles,
 * twelve rank rows and twelve match histories (~18.5 MB) to fill something no
 * renderer read. Everything the chiron shows is about the operator.
 *
 * `phase` is still the match phase, supplied by the game log — it is what fires
 * the sweep and the ident, and that does not need a roster.
 */
export function emptyState(reason = '', { operator = null, session = {}, mode = 'normal' } = {}) {
  return {
    phase: 'IDLE', matchId: null, reason, operator, mode,
    session, streamer: STREAMER, generatedAt: Date.now()
  };
}

/**
 * Serve the last good document rather than nothing. Spec section 9: never
 * render a hole. `stale` is for our logs — the overlay does not surface which
 * feed failed, because a real broadcast does not caption its own plumbing. It
 * shows the AGE of the data instead; see session.lastMatchAt.
 */
export function fallbackState(previous, reason = '') {
  // Keyed on the operator row, which is the whole of what the chiron renders.
  // This checked `teams` for a player row until the roster was removed —
  // `teams` is gone, so that test was silently false and every failure, even
  // after a good fetch, fell through to the empty document. The condition has
  // to name something the document still has.
  //
  // Checking for the row rather than for the document means a cold-start
  // failure refreshes generatedAt each tick instead of freezing on the
  // starting placeholder.
  if (previous?.operator) {
    return { ...previous, stale: true, reason };
  }
  return { ...emptyState(reason), stale: true };
}
