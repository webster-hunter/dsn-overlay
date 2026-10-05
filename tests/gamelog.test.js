import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLog } from '../proxy/gamelog.js';

// Lines copied verbatim from a real Deadlock console.log during a real match.
const REAL = `
10/05 12:27:17 Local bot match: Init. -citadel_local_lobby='', -citadel_local_report_port=0
10/05 12:27:20 ChangeGameState: HeroSelection (3)
10/05 12:27:37 Hero Roster:
10/05 12:27:37 Pick: 60 (2)
10/05 12:27:37 [GCClient] Send msg 9010 (k_EMsgClientToGCStartMatchmaking), 294 bytes
10/05 12:27:41 [SteamNetSockets] Received Steam datagram ticket for server steamid:90294154074069013 vport -1. match_id=100000901
10/05 12:27:41 Lobby 174100000000000001 for Match 100000901 created
10/05 12:27:52 OnGameStateChanged: MatchIntro (4)
10/05 12:27:58 OnGameStateChanged: GameInProgress (7)
`;

test('reads the match id and live phase from a real log tail', () => {
  const s = parseLog(REAL);
  assert.equal(s.phase, 'MATCH');
  assert.equal(s.state, 'GameInProgress');
  assert.equal(s.matchId, '100000901');
  assert.equal(s.lobbyId, '174100000000000001');
});

test('a match being formed is reported as FORMING, not yet MATCH', () => {
  // The rail should not claim a live match while heroes are still being picked.
  const s = parseLog(REAL.replace('OnGameStateChanged: GameInProgress (7)',
                                  'OnGameStateChanged: MatchIntro (4)'));
  assert.equal(s.phase, 'FORMING');
  assert.equal(s.matchId, '100000901', 'the id is known before play starts');
});

test('queueing is distinguished from being in a match', () => {
  const queueing = `
10/05 12:27:37 [GCClient] Send msg 9010 (k_EMsgClientToGCStartMatchmaking), 294 bytes
`;
  const s = parseLog(queueing);
  assert.equal(s.phase, 'QUEUE');
  assert.equal(s.matchId, null, 'no match exists yet, so no id may be reported');
});

test('a match id with no live state is not reported as the current match', () => {
  // The rail is meant to show the CURRENT match only. An id sitting in the log
  // tail with nothing saying a match is underway must not present as live.
  //
  // NOTE: the state Deadlock reports AFTER a match ends is not yet known — the
  // capture used here was taken mid-match. Until that is observed, this pins
  // the safe direction: absent a live state, report nothing as live.
  const s = parseLog('10/05 12:27:41 Lobby 174100000000000001 for Match 100000901 created');
  assert.equal(s.phase, 'IDLE');
  assert.equal(s.matchId, null, 'a stale id must not be reported as the live match');
  assert.equal(s.lastMatchId, '100000901', 'but it is still available as the last match');
});

test('an empty or absent log is idle, not an error', () => {
  for (const input of ['', null, undefined, 'nothing relevant here\n']) {
    const s = parseLog(input);
    assert.equal(s.phase, 'IDLE');
    assert.equal(s.matchId, null);
  }
});
