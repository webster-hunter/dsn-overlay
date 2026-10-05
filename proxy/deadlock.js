import { HISTORY_CONCURRENCY } from './config.js';

const API = 'https://api.deadlock-api.com/v1';

async function get(path) {
  const res = await fetch(API + path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`deadlock-api ${path} -> ${res.status}`);
  return res.json();
}

/** Watch-tab index, ~150 concurrent matches, sorted by average MMR.
 *  100 req/s. Returns the match object or null if this player isn't in it. */
export async function activeMatchFor(accountId) {
  const rows = await get(`/matches/active?account_id=${accountId}`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** 100 req/s on the read path. -> [{account_id, personaname, avatar, ...}] */
export function batchSteam(ids) {
  return get(`/players/steam?account_ids=${ids.join(',')}`);
}

/** 20 req/min per IP — the project's rate ceiling. Once per match, never poll.
 *  -> [{account_id, badge, rank, subrank, last_match}] */
export function batchRank(ids) {
  return get(`/players/rank?account_ids=${ids.join(',')}`);
}

/** 100 req/s. Measured 18.5MB across a 12-player roster, up to 2.54MB for one
 *  heavy account. Caller must reduce and release each response as it arrives. */
export function matchHistory(accountId) {
  return get(`/players/${accountId}/match-history`);
}

/** 60 req/60s. vars is an array of names from /v1/commands/variables/available. */
export function resolveCommands(accountId, vars) {
  const q = new URLSearchParams({ account_id: String(accountId), query: vars.join(',') });
  return get(`/commands/resolve?${q}`);
}

/**
 * Map ids through fn with bounded concurrency. Twelve histories total ~18.5MB;
 * pulling them all at once would hold that in memory and compete with the
 * stream's uplink for no benefit. Three at a time measures at 2.4s wall clock,
 * which is immaterial against a 30-40 minute match.
 */
export async function mapLimited(ids, fn, limit = HISTORY_CONCURRENCY) {
  const out = new Map();
  const queue = ids.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      try { out.set(id, await fn(id)); } catch { out.set(id, null); }
    }
  });
  await Promise.all(workers);
  return out;
}
