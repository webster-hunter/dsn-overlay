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

test('a lobby created and never destroyed is a match forming', () => {
  // Written before the "destroyed" line was observed, this asserted IDLE on the
  // theory that an id without a live state was stale. The lobby pair showed the
  // opposite: a created lobby with no state yet IS a match, just not started.
  const s = parseLog('10/05 12:27:41 Lobby 174100000000000001 for Match 100000901 created');
  assert.equal(s.phase, 'FORMING');
  assert.equal(s.matchId, '100000901');
});

test('an empty or absent log is idle, not an error', () => {
  for (const input of ['', null, undefined, 'nothing relevant here\n']) {
    const s = parseLog(input);
    assert.equal(s.phase, 'IDLE');
    assert.equal(s.matchId, null);
  }
});

test('the hideout after a match is not mistaken for a live match', () => {
  // Captured verbatim after a real match ended. The client returns to the
  // hideout and reports GameInProgress (7) again — identical to the state
  // during play. Only the lobby's "destroyed" line distinguishes them, which
  // is why the parser keys on the lobby rather than on game state.
  const afterMatch = `
10/05 12:27:41 Lobby 174100000000000001 for Match 100000901 created
10/05 12:27:58 OnGameStateChanged: GameInProgress (7)
10/05 12:45:37 OnGameStateChanged: PostGame (8)
10/05 12:45:38 Lobby 174100000000000001 for Match 100000901 destroyed
10/05 12:45:47 OnGameStateChanged: End (11)
10/05 12:45:52 ChangeGameState: GameInProgress (7)
10/05 12:45:52 OnGameStateChanged: GameInProgress (7)
`;
  const s = parseLog(afterMatch);
  assert.equal(s.phase, 'IDLE', 'the hideout is not a match');
  assert.equal(s.state, 'GameInProgress', 'even though the state says otherwise');
  assert.equal(s.matchId, null, 'nothing may be reported as the current match');
  assert.equal(s.lastMatchId, '100000901', 'the finished match is still identifiable');
});
