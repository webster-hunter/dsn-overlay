import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveStatic } from './static.js';
import { buildState, emptyState, fallbackState } from './state.js';
import { derivePlayer } from './derive.js';
import { makeCache } from './cache.js';
import {
  activeMatchFor, batchSteam, batchRank, matchHistory, mapLimited
} from './deadlock.js';
import { ACCOUNT_ID, POLL_MS, MATCH_TTL_MS } from './config.js';

const PORT = Number(process.env.PORT ?? 7331);
const matchCache = makeCache(MATCH_TTL_MS);

// Resolved against this module, not the process cwd, so `npm run serve`
// works the same regardless of the directory it is launched from.
const FIXTURES = new URL('../fixtures/', import.meta.url);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.otf': 'font/otf'
};

export let current = emptyState('starting');

/** Fetch and reduce. Raw histories are discarded immediately — 12 x 2.5MB
 *  must never all be held at once. */
/**
 * Guards against overlapping refreshes. setInterval does not await, so if one
 * run exceeds POLL_MS (15s) a second would start before the cache is written —
 * two concurrent 17-call, 18.5MB assemblies writing the same key. Measured
 * assembly is 2.4s, but the slowest single history was 1,448ms, so a slow API
 * or a network stall can cross 15s.
 */
let refreshing = false;

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    await doRefresh();
  } finally {
    refreshing = false;
  }
}

export async function doRefresh() {
  // An unconfigured ACCOUNT_ID is 0, and /v1/matches/active IGNORES a falsy
  // account_id filter — it returns the whole 150-match watch list. Polling
  // unguarded would pick a stranger's match, fetch twelve strangers' histories
  // (18.5 MB), and render a complete, plausible broadcast of someone else's
  // game that changes every poll. Wrong data that looks right is the worst
  // failure mode on a broadcast, so refuse to run rather than guess.
  if (!ACCOUNT_ID) { current = emptyState('DSN_ACCOUNT_ID is not set'); return; }

  try {
    const match = await activeMatchFor(ACCOUNT_ID);
    if (!match) { current = emptyState('no active match'); return; }

    const key = String(match.match_id);
    if (!matchCache.stale(key)) { current = matchCache.get(key); return; }

    const ids = match.players.map(p => p.account_id);
    const [steam, ranks] = await Promise.all([batchSteam(ids), batchRank(ids)]);

    // Derive inside the worker so each ~2.5MB payload is reduced to a small
    // object and released before the next is fetched. Peak memory is one
    // history, not twelve.
    const derived = new Map();
    await mapLimited(ids, async id => {
      const raw = await matchHistory(id);
      derived.set(id, derivePlayer(raw));
      return true;
    });

    const state = buildState({ match, steam, ranks, derived, operatorId: ACCOUNT_ID });
    matchCache.set(key, state);
    current = state;
  } catch (err) {
    console.error('[refresh]', err.message);
    current = fallbackState(current, err.message);
  }
}

/**
 * A single malformed request must never take the whole process down — the
 * overlay does not notice the proxy dying (app.js just keeps rendering the
 * last good /state it fetched), so a crash here looks like nothing happened
 * for the rest of the broadcast. Every request routes through this one
 * function, so one try/catch at the root covers every thrower underneath it.
 */
function handleRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://localhost:${PORT}`);
  } catch {
    // e.g. `//:` — new URL() throws Invalid URL rather than parsing it.
    return res.writeHead(400).end('bad request');
  }

  if (url.pathname === '/state') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store'
      // No access-control-allow-origin: the overlay is same-origin with this
      // proxy and never needed it. Anything else is an uninvited reader of
      // the operator's account id, which row is them, and live match status.
    });
    return res.end(JSON.stringify(current));
  }

  if (url.pathname === '/fixture') {
    const match = JSON.parse(readFileSync(new URL('active.sample.json', FIXTURES), 'utf8'));
    const history = JSON.parse(readFileSync(new URL('match-history.sample.json', FIXTURES), 'utf8'));
    const stats = derivePlayer(history);
    const state = buildState({
      match,
      steam: JSON.parse(readFileSync(new URL('steam.sample.json', FIXTURES), 'utf8')),
      ranks: JSON.parse(readFileSync(new URL('rank.sample.json', FIXTURES), 'utf8')),
      derived: new Map(match.players.map(p => [p.account_id, stats])),
      operatorId: ACCOUNT_ID || match.players[0].account_id
    });
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(state));
  }

  // Static overlay files. Resolution lives in proxy/static.js so the traversal
  // test imports the real function rather than a hand-copied duplicate of it.
  const file = resolveStatic(url.pathname);
  let stat;
  try {
    stat = statSync(file);
  } catch {
    return res.writeHead(404).end('not found');
  }
  // GET /logo resolves to a directory, not a file — readFileSync on it
  // throws EISDIR. A directory is a legitimate 404, not a traversal escape.
  if (!stat.isFile()) return res.writeHead(404).end('not found');

  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

export const server = createServer((req, res) => {
  try {
    handleRequest(req, res);
  } catch (err) {
    console.error('[http]', err.message);
    if (!res.headersSent) res.writeHead(500);
    res.end('internal error');
  }
});

// Only bind the port and start polling when this file is run directly (`npm
// run serve`), not when a test imports it for `doRefresh`/`current` — an
// import-time listen() + setInterval() would hold the port and the event
// loop open for the lifetime of the test process.
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  // Loopback only: OBS loads the overlay from this same machine. Binding
  // every interface (the default with no host argument) exposes /state —
  // the operator's account id, which roster row is them, live match status —
  // plus every static file, to the whole LAN.
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`DSN proxy on http://localhost:${PORT}`);
    console.log(`  overlay   http://localhost:${PORT}/`);
    console.log(`  state     http://localhost:${PORT}/state`);
    console.log(`  fixture   http://localhost:${PORT}/fixture   (no game needed)`);
    if (!ACCOUNT_ID) {
      console.warn('');
      console.warn('  !! DSN_ACCOUNT_ID is not set. /state will stay IDLE and no');
      console.warn('     live match will be detected. Use /fixture to develop the');
      console.warn('     overlay without a game running.');
      console.warn('     Set it to your SteamID3 numeric part, e.g.');
      console.warn('       DSN_ACCOUNT_ID=123456789 npm run serve');
      console.warn('');
    }
  });

  refresh();
  setInterval(refresh, POLL_MS);
}
