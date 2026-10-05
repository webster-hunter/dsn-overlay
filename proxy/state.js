import { rankLabel, tierColor } from './rank.js';
import { FACTIONS, TEAM0_IS_AMBER, STREAMER } from './config.js';
import { rankStats } from './registry.js';

const PLACEHOLDER_NAME = 'UNKNOWN';

/** Shape-compatible zero value, so a player with no history still renders. */
const EMPTY_DERIVED = {
  form: ' '.repeat(11),
  season: { wins: 0, losses: 0, text: '0-0' },
  abandons: 0,
  streak: { kind: null, n: 0 },
  averages: { kd: 0, netWorth: 0, lastHits: 0, denies: 0, matchLen: 0 },
  matches: 0
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

function playerRow(p, steamById, rankById, derived, operatorId) {
  const prof = steamById.get(p.account_id);
  const rk = rankById.get(p.account_id);
  // Pre-derived by the caller so each 2.5MB history is released before the
  // next is fetched. EMPTY_DERIVED keeps a missing entry renderable.
  const d = derived.get(p.account_id) ?? EMPTY_DERIVED;
  const kd = d.averages.kd;
  const ranked = (rk?.rank ?? 0) > 0;
  return {
    accountId: p.account_id,
    // A private profile or an omitted batch row must not blank the board.
    name: prof?.personaname?.trim() || PLACEHOLDER_NAME,
    heroId: p.hero_id ?? null,
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
    rankColor: ranked ? tierColor(rk.rank) : tierColor(-1),
    kd: Number.isFinite(kd) ? kd.toFixed(1) : '∞',
    streak: d.streak.kind ? `${d.streak.kind}${d.streak.n}` : '0',
    netWorth: k(d.averages.netWorth),
    lastHits: String(Math.round(d.averages.lastHits)),
    denies: String(Math.round(d.averages.denies)),
    matches: String(d.matches)
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
export function operatorRow({ accountId, steam = [], ranks = [], derived = new Map() }) {
  if (!(accountId > 0)) return null;
  return playerRow(
    { account_id: accountId, hero_id: null },
    indexBy(steam, 'account_id'),
    indexBy(ranks, 'account_id'),
    derived,
    accountId
  );
}

export function emptyState(reason = '', operator = null) {
  return {
    phase: 'IDLE', matchId: null, reason, operator,
    factions: FACTIONS,
    teams: [
      { faction: FACTIONS.amber, colorVar: '--team-amber', players: [] },
      { faction: FACTIONS.sapphire, colorVar: '--team-sapphire', players: [] }
    ],
    session: {}, salient: [], streamer: STREAMER, generatedAt: Date.now()
  };
}

export function buildState({
  match, steam, ranks, derived, operatorId = 0, session = {}, now = Date.now()
}) {
  if (!match?.players?.length) return { ...emptyState('no active match'), generatedAt: now };

  const steamById = indexBy(steam, 'account_id');
  const rankById = indexBy(ranks, 'account_id');

  const amberIdx = TEAM0_IS_AMBER ? 0 : 1;
  const stats = derived ?? new Map();
  const bucket = { amber: [], sapphire: [] };
  for (const p of match.players) {
    const side = p.team === amberIdx ? 'amber' : 'sapphire';
    bucket[side].push(playerRow(p, steamById, rankById, stats, operatorId));
  }
  // The operator is pinned first within their own faction — spec section 5.1.
  for (const side of ['amber', 'sapphire']) {
    bucket[side].sort((a, b) => Number(b.isSelf) - Number(a.isSelf));
  }

  const doc = {
    phase: 'MATCH',
    matchId: match.match_id ?? null,
    factions: FACTIONS,
    teams: [
      { faction: FACTIONS.amber, colorVar: '--team-amber', players: bucket.amber },
      { faction: FACTIONS.sapphire, colorVar: '--team-sapphire', players: bucket.sapphire }
    ],
    session,
    streamer: STREAMER,
    generatedAt: now,
    salient: []
  };
  // One place to find the streamer, match or no match: during a match this is
  // the same object already pinned first in their faction.
  doc.operator = [...bucket.amber, ...bucket.sapphire].find(p => p.isSelf) ?? null;
  doc.salient = rankStats(doc);
  return doc;
}

/**
 * Serve the last good document rather than nothing. Spec section 9: never
 * render a hole. `stale` is for our logs — the overlay does not surface it,
 * because a real network never captions which feed failed.
 */
export function fallbackState(previous, reason = '') {
  // teams.length is always 2 — emptyState included — so checking it tells us
  // nothing about whether `previous` actually carries a roster. Check for a
  // player row instead, or a cold-start failure freezes generatedAt on the
  // starting placeholder forever instead of refreshing it each tick.
  if (previous?.teams?.some(t => t.players?.length)) {
    return { ...previous, stale: true, reason };
  }
  return { ...emptyState(reason), stale: true };
}
