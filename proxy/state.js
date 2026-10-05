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
  return {
    accountId: p.account_id,
    // A private profile or an omitted batch row must not blank the board.
    name: prof?.personaname?.trim() || PLACEHOLDER_NAME,
    heroId: p.hero_id ?? null,
    isSelf: operatorId > 0 && p.account_id === operatorId,
    form: d.form,
    season: d.season.text,
    abandons: String(d.abandons),
    rank: rk ? rankLabel(rk.rank, rk.subrank) : 'UNRANKED',
    rankColor: rk ? tierColor(rk.rank) : tierColor(-1),
    kd: Number.isFinite(kd) ? kd.toFixed(1) : '∞',
    streak: d.streak.kind ? `${d.streak.kind}${d.streak.n}` : '0',
    netWorth: k(d.averages.netWorth),
    lastHits: String(Math.round(d.averages.lastHits)),
    denies: String(Math.round(d.averages.denies)),
    matches: String(d.matches)
  };
}

export function emptyState(reason = '') {
  return {
    phase: 'IDLE', matchId: null, reason,
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
