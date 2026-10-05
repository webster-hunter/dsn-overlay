import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { buildState, emptyState } from './state.js';
import { derivePlayer } from './derive.js';
import { makeCache } from './cache.js';
import {
  activeMatchFor, batchSteam, batchRank, matchHistory, mapLimited
} from './deadlock.js';
import { ACCOUNT_ID, POLL_MS, MATCH_TTL_MS } from './config.js';

const PORT = Number(process.env.PORT ?? 7331);
const matchCache = makeCache(MATCH_TTL_MS);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.otf': 'font/otf'
};

let current = emptyState('starting');

/** Fetch and reduce. Raw histories are discarded immediately — 12 x 2.5MB
 *  must never all be held at once. */
async function refresh() {
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

    const state = buildState({ match, steam, ranks, derived });
    matchCache.set(key, state);
    current = state;
  } catch (err) {
    // Never render a hole: keep serving the last good document.
    console.error('[refresh]', err.message);
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/state') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    });
    return res.end(JSON.stringify(current));
  }

  if (url.pathname === '/fixture') {
    const match = JSON.parse(readFileSync('fixtures/active.sample.json', 'utf8'));
    const history = JSON.parse(readFileSync('fixtures/match-history.sample.json', 'utf8'));
    const stats = derivePlayer(history);
    const state = buildState({
      match,
      steam: JSON.parse(readFileSync('fixtures/steam.sample.json', 'utf8')),
      ranks: JSON.parse(readFileSync('fixtures/rank.sample.json', 'utf8')),
      derived: new Map(match.players.map(p => [p.account_id, stats]))
    });
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(state));
  }

  // Static overlay files.
  //
  // This is safe against path traversal, but for non-obvious reasons worth
  // naming so a later "simplification" does not remove the protection. Two
  // independent layers:
  //   1. WHATWG URL collapses `..` segments in `pathname` before we see it, and
  //      decodes %2e — so `/%2e%2e/%2e%2e/x` arrives as `/x`.
  //   2. `path.normalize` CLAMPS `..` at root for a `/`-prefixed path:
  //      normalize('/../../../x') === '\\x', never '../../x'.
  // The `.replace` then covers the no-leading-slash case. Verified against 13
  // attack vectors (encoded, double-encoded, `....//`, null byte, backslash);
  // see the traversal test in tests/server.test.js.
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = join('overlay', normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (existsSync(file)) {
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    return res.end(readFileSync(file));
  }
  res.writeHead(404).end('not found');
});

server.listen(PORT, () => {
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
