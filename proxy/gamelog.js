/**
 * Reads Deadlock's own console.log to learn what match the operator is in.
 *
 * This exists because the API cannot tell us. deadlock-api's only live source
 * is /v1/matches/active, which its documentation calls the in-game watch tab,
 * "limited to the top 200 matches". Confirmed by observation: that endpoint
 * returned [] for this account *while it was in a match*. No endpoint maps a
 * player to their current match, and sponsoring does not change that — priority
 * fetching accelerates finished-match ingestion, not live detection.
 *
 * The game knows, and the proxy runs on the same machine. With `-condebug` in
 * Deadlock's launch options it writes game/citadel/console.log.
 *
 * Every pattern below was taken from a real log during a real match, not from
 * documentation — none of this is documented anywhere I could find.
 */
import { existsSync, statSync, createReadStream } from 'node:fs';

/**
 * Observed:
 *   10/05 12:27:41 Lobby 174100000000000001 for Match 100000901 created
 * Carries both ids in one line and appears exactly when the match is formed.
 */
const LOBBY_LINE = /Lobby\s+(\d+)\s+for\s+Match\s+(\d+)\s+created/i;

/**
 * Observed on the same second, as a second witness:
 *   [SteamNetSockets] Received Steam datagram ticket for server ... match_id=100000901
 */
const MATCH_ID = /\bmatch_id=(\d+)/i;

/**
 * Observed states, in the order the client passes through them:
 *   2 WaitingForPlayersToJoin, 3 HeroSelection, 4 MatchIntro,
 *   5 WaitForMapToLoad, 6 PreGameWait, 7 GameInProgress
 *
 * `OnGameStateChanged` is the client reporting its own state; `ChangeGameState`
 * also appears but fires during local setup too, so the former is preferred and
 * the latter accepted only as a fallback.
 */
const STATE = /OnGameStateChanged:\s*(\w+)\s*\((\d+)\)/;
const STATE_FALLBACK = /ChangeGameState:\s*(\w+)\s*\((\d+)\)/;

/** Observed: [GCClient] Send msg 9010 (k_EMsgClientToGCStartMatchmaking) */
const QUEUE_START = /k_EMsgClientToGCStartMatchmaking\b/;

/** The states that mean a match is actually underway. */
const IN_MATCH = new Set(['GameInProgress']);

/** States that mean a match exists but has not started playing yet. */
const FORMING = new Set([
  'WaitingForPlayersToJoin', 'HeroSelection', 'MatchIntro',
  'WaitForMapToLoad', 'PreGameWait'
]);

/**
 * Reads the log and returns what it says about right now. Pure apart from the
 * file read, so it is testable by passing text straight to `parseLog`.
 */
export function parseLog(text) {
  let matchId = null;
  let lobbyId = null;
  let state = null;
  let queued = false;

  for (const line of String(text ?? '').split(/\r?\n/)) {
    const lobby = line.match(LOBBY_LINE);
    if (lobby) { lobbyId = lobby[1]; matchId = lobby[2]; queued = false; continue; }

    const mid = line.match(MATCH_ID);
    if (mid) { matchId = mid[1]; continue; }

    const st = line.match(STATE) ?? line.match(STATE_FALLBACK);
    if (st) { state = st[1]; continue; }

    if (QUEUE_START.test(line)) queued = true;
  }

  const phase = IN_MATCH.has(state) ? 'MATCH'
    : FORMING.has(state) ? 'FORMING'
    : queued ? 'QUEUE'
    : 'IDLE';

  // A match id without a live state is last match's id, not this one. The rail
  // is meant to show the CURRENT match only, so do not report a stale id as live.
  return {
    phase,
    state,
    matchId: phase === 'MATCH' || phase === 'FORMING' ? matchId : null,
    lobbyId: phase === 'MATCH' || phase === 'FORMING' ? lobbyId : null,
    lastMatchId: matchId
  };
}

const EMPTY = { phase: 'IDLE', state: null, matchId: null, lobbyId: null, lastMatchId: null };

/**
 * Reads the tail of the log. Only the tail: a long session produces megabytes,
 * and the current state is always at the end.
 */
export async function readGameLog(path, tailBytes = 512 * 1024) {
  if (!path || !existsSync(path)) return { ...EMPTY, available: false };
  let size;
  try { size = statSync(path).size; } catch { return { ...EMPTY, available: false }; }

  const start = Math.max(0, size - tailBytes);
  const text = await new Promise(resolve => {
    let buf = '';
    createReadStream(path, { start, encoding: 'utf8' })
      .on('data', c => { buf += c; })
      .on('end', () => resolve(buf))
      .on('error', () => resolve(''));
  });
  return { ...parseLog(text), available: true };
}
