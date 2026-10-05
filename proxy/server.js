import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveStatic } from './static.js';
import { buildState, emptyState, fallbackState, operatorRow } from './state.js';
import { derivePlayer, sessionToday, isBrawl, isCountable, GAME_MODES } from './derive.js';
import { makeCache } from './cache.js';
import {
  activeMatchFor, batchSteam, batchRank, matchHistory, mapLimited
} from './deadlock.js';
import { readGameLog } from './gamelog.js';
import {
  ACCOUNT_ID, POLL_MS, MATCH_TTL_MS, CONTEXT_TTL_MS, SELF_RECHECK_MS, DEADLOCK_LOG
} from './config.js';

const PORT = Number(process.env.PORT ?? 7331);

/** Served no-store so an edited overlay is never masked by a cached copy. */
const CODE_EXT = new Set(['.html', '.js', '.css']);
const matchCache = makeCache(MATCH_TTL_MS);
// The operator's own history is one ~2.5MB call. Cached on the context TTL so
// idling between matches costs one fetch an hour, not one per 15s poll.
const selfCache = makeCache(CONTEXT_TTL_MS);
// Whether a match has been observed since the operator's history was last
// fetched. Tracked separately from `current.phase`, which other paths
// legitimately overwrite — fallbackState on an outage, emptyState on a cold
// start — and so cannot be relied on to remember that a match happened.
let sawMatch = false;
let lastSelfFetch = 0;

// Resolved against this module, not the process cwd, so `npm run serve`
// works the same regardless of the directory it is launched from.
const FIXTURES = new URL('../fixtures/', import.meta.url);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.otf': 'font/otf', '.webp': 'image/webp'
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

/**
 * Idle does not mean empty. Four of the chiron's five turns are about the
 * operator rather than the match, so between games we still build their row —
 * record, form, abandons, K/D — and leave `teams` empty, because only the
 * Matchup turn genuinely needs opponents.
 *
 * A failure here must not escalate: the overlay showing dashes is the normal
 * idle look, so a bad fetch falls back to the plain idle document.
 */
async function idleState() {
  const key = String(ACCOUNT_ID);
  if (!selfCache.stale(key)) return emptyState('no active match', selfCache.get(key));
  try {
    const [steam, ranks] = await Promise.all([
      batchSteam([ACCOUNT_ID]), batchRank([ACCOUNT_ID])
    ]);
    const history = await matchHistory(ACCOUNT_ID);
    const derived = new Map([[ACCOUNT_ID, derivePlayer(history)]]);
    // Everything in an idle document describes the same mode: whichever the
    // operator played last. Mixing a normal headline with a brawl session
    // would be worse than either on its own.
    const mode = derived.get(ACCOUNT_ID)?.lastMode ?? 'normal';
    const built = {
      mode,
      operator: operatorRow({ accountId: ACCOUNT_ID, steam, ranks, derived, mode }),
      session: sessionToday(history, startOfToday(), mode === 'brawl' ? isBrawl : isCountable)
    };
    selfCache.set(key, built);
    lastSelfFetch = Date.now();
    return emptyState('no active match', built);
  } catch (err) {
    console.warn('[idle] could not build the operator row:', err.message);
    return emptyState('no active match');
  }
}

/**
 * A match is running, but the API will not name its players.
 *
 * This is the normal case, not the degraded one: /v1/matches/active is the
 * in-game watch tab and an ordinary account's game is never in it, so the log
 * knows a match exists while the only roster source does not. The document
 * therefore carries the real phase with empty teams — which the chiron already
 * renders as dashes, the same as any other absent group.
 *
 * The phase is what matters here even without a roster: it is what fires the
 * sweep when play starts and the ident when the match ends.
 */
async function liveState(log) {
  const idle = await idleState();
  return {
    ...idle,
    phase: log.phase,
    matchId: log.matchId,
    reason: log.phase === 'MATCH' ? 'in match' : 'match forming'
  };
}

/** Local midnight. The streamer's "today" is their day, not UTC's. */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
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
    // Deadlock's own log decides whether a match is running. The API cannot:
    // /v1/matches/active is the watch tab, and it returned [] for this account
    // *while it was mid-match*. Without -condebug the log does not exist, which
    // readGameLog reports rather than throwing — and then this falls back to
    // the API exactly as it did before, which is the best available answer.
    const log = await readGameLog(DEADLOCK_LOG);
    const logSaysLive = log.available && (log.phase === 'MATCH' || log.phase === 'FORMING');

    // The roster still comes from the API, the only place it exists. Asking is
    // worth it even when the log already knows a match is on: for an account
    // whose match IS in the watch tab, this is what populates the Matchup turn.
    const match = await activeMatchFor(ACCOUNT_ID);

    if (!match) {
      if (logSaysLive) {
        // Known to be in a match the API will not describe. Carry the phase so
        // the transitions fire, and let the roster be absent.
        sawMatch = true;
        current = await liveState(log);
        return;
      }
      // A match ending is exactly when today's record, form and streak change,
      // and exactly when someone is looking at the overlay.
      if (sawMatch) {
        sawMatch = false;
        selfCache.drop(String(ACCOUNT_ID));
        console.log('[refresh] match ended — refreshing the operator history');
      } else if (lastSelfFetch && Date.now() - lastSelfFetch > SELF_RECHECK_MS) {
        // Net for a match neither source reported: without this a missed match
        // stays invisible for the whole CONTEXT_TTL_MS hour.
        selfCache.drop(String(ACCOUNT_ID));
        console.log('[refresh] periodic re-check of the operator history');
      }
      current = await idleState();
      return;
    }
    sawMatch = true;

    const key = String(match.match_id);
    if (!matchCache.stale(key)) { current = matchCache.get(key); return; }

    const ids = match.players.map(p => p.account_id);
    const [steam, ranks] = await Promise.all([batchSteam(ids), batchRank(ids)]);

    // Derive inside the worker so each ~2.5MB payload is reduced to a small
    // object and released before the next is fetched. Peak memory is one
    // history, not twelve.
    const derived = new Map();
    let session = {};
    await mapLimited(ids, async id => {
      const raw = await matchHistory(id);
      derived.set(id, derivePlayer(raw));
      // The operator's history is already in hand here, so today's numbers cost
      // nothing extra — no second fetch, and the raw payload is still released
      // before the next one arrives.
      if (id === ACCOUNT_ID) {
        session = sessionToday(raw, startOfToday(),
          match.game_mode === GAME_MODES.brawl ? isBrawl : isCountable);
      }
      return true;
    });

    const state = buildState({ match, steam, ranks, derived, operatorId: ACCOUNT_ID, session });
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
/**
 * Loopback binding stops the network reaching this, but not a browser on this
 * same machine. A page the streamer visits can point a hostname it controls at
 * 127.0.0.1 and then fetch http://that-name:7331/state same-origin, which CORS
 * does not prevent — CORS governs reading a cross-origin reply, and after the
 * rebind the browser no longer considers it cross-origin. The reply carries the
 * operator's account id, persona, rank and whether they are in a match.
 *
 * The request still has to name a host, and a rebound name is never one of
 * these. There is no write path here, so this is the whole of the fix.
 */
const PORT_SUFFIX = new RegExp(':[0-9]+$');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function hostAllowed(header) {
  if (!header) return false;                    // HTTP/1.1 requires Host
  const text = String(header).toLowerCase();
  // Drop a trailing :port. Bracketed IPv6 keeps its brackets, which is why
  // both forms are in the set above.
  const host = text.replace(PORT_SUFFIX, '');
  return LOCAL_HOSTS.has(host);
}

function handleRequest(req, res) {
  // Checked before anything else looks at the request, including the URL.
  if (!hostAllowed(req.headers.host)) {
    return res.writeHead(403, { 'content-type': 'text/plain' })
      .end('dsn: this proxy serves localhost only');
  }

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
      // The configured id only if the recorded roster actually contains it.
      // `ACCOUNT_ID || players[0]` was backwards: a configured .env — which the
      // README tells every user to set — is truthy but is not in this fixture,
      // so no row was isSelf, `operator` came out null, and all five chiron
      // turns rendered dashes. ?fixture worked only for an UNCONFIGURED proxy,
      // which is the one state a developer never leaves it in.
      operatorId: match.players.some(p => p.account_id === ACCOUNT_ID)
        ? ACCOUNT_ID
        : match.players[0].account_id,
      // Without this the Session turn is dead in the only development path,
      // which is where it gets looked at. The recorded history is old, so this
      // exercises the honest case: no matches today, and a freshness age that
      // says how long ago the newest one was.
      session: sessionToday(history, startOfToday())
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

  // Overlay code changes every time the overlay is edited, and a response with
  // no freshness information is left to the browser's heuristics — OBS's
  // embedded Chromium will reuse it, which looks exactly like the edit not
  // working. Vendored binaries only change via `npm run vendor`, so they stay
  // cacheable; re-fetching 600KB of fonts on every reload would flash the
  // fallback face.
  const ext = extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': CODE_EXT.has(ext) ? 'no-store' : 'public, max-age=86400'
  });
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
    if (ACCOUNT_ID) {
      // Echo what it resolved to: the operator may have pasted a SteamID64 or
      // a [U:1:...] form, and seeing the account id confirms it was understood.
      console.log(`  account   ${ACCOUNT_ID}`);
    } else {
      const given = (process.env.DSN_ACCOUNT_ID ?? '').trim();
      console.warn('');
      if (given) {
        // Distinct from "not set": they did set one, it just wasn't readable.
        console.warn(`  !! DSN_ACCOUNT_ID is set to ${JSON.stringify(given)}, which is not a`);
        console.warn('     Steam identifier this understands. Accepted forms:');
        console.warn('       123456788            Friend Code / account id');
        console.warn('       76561198083722516     SteamID64, from a profile URL');
        console.warn('       [U:1:123456788]      SteamID3');
        console.warn('       STEAM_0:0:61728394   legacy SteamID');
      } else {
        console.warn('  !! DSN_ACCOUNT_ID is not set. Copy .env.example to .env and');
        console.warn('     paste any Steam identifier for your account — Friend Code,');
        console.warn('     SteamID64, [U:1:...] or STEAM_0:... all work.');
      }
      console.warn('     /state will stay IDLE and no live match will be detected.');
      console.warn('     Use /fixture to develop the overlay without a game running.');
      console.warn('');
    }
  });

  refresh();
  setInterval(refresh, POLL_MS);
}
