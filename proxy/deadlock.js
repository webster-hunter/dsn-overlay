import { HISTORY_CONCURRENCY } from './config.js';

const API = 'https://api.deadlock-api.com/v1';

async function get(path) {
  let res;
  try {
    res = await fetch(API + path, { headers: { accept: 'application/json' } });
  } catch (cause) {
    // DNS failure, connection reset, timeout. Without the path these are
    // undiagnosable from a log line, since the proxy calls five endpoints.
    throw new Error(`deadlock-api ${path} -> network: ${cause.message}`, { cause });
  }
  if (!res.ok) throw new Error(`deadlock-api ${path} -> ${res.status}`);
  try {
    return await res.json();
  } catch (cause) {
    throw new Error(`deadlock-api ${path} -> malformed JSON: ${cause.message}`, { cause });
  }
}

/**
 * Watch-tab index, ~150 concurrent matches, sorted by average MMR. 100 req/s.
 * Returns the match object, or null when this player is not in the index.
 *
 * The falsy guard is load-bearing, not defensive padding. The endpoint IGNORES
 * a falsy account_id and returns the ENTIRE 150-match list — measured:
 * `?account_id=0` gives 200 with 150 matches, `?account_id=1` gives 200 with
 * []. Since ACCOUNT_ID defaults to 0 when DSN_ACCOUNT_ID is unset, calling
 * through would hand back a stranger's live game, and the overlay would render
 * a complete, plausible broadcast of someone else's match. Short-circuit before
 * the request rather than let a default produce wrong-but-believable output.
 */
export async function activeMatchFor(accountId) {
  if (!Number.isInteger(accountId) || accountId <= 0) return null;
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
      try {
        out.set(id, await fn(id));
      } catch (err) {
        // Isolate the failure — one bad history must not lose the other eleven —
        // but do not swallow it silently, or a null is indistinguishable from a
        // genuinely empty history when the chiron shows those stats as zeroes.
        console.error(`[mapLimited] ${id} failed: ${err.message}`);
        out.set(id, null);
      }
    }
  });
  await Promise.all(workers);
  return out;
}
