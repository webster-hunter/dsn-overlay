import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * The game log is the only thing that knows the operator is in a match, and it
 * was written, tested and documented while being wired to nothing — so the
 * overlay's phase never left IDLE, and neither transition could ever fire. That
 * is what this file pins: not that parseLog works (tests/gamelog.test.js covers
 * that) but that the server acts on what it says.
 *
 * Same isolation contract as tests/server-refresh.test.js: mutating process.env
 * and globalThis.fetch before importing proxy/server.js requires its own
 * process, which `node --test` gives each file.
 */
const dir = mkdtempSync(join(tmpdir(), 'dsn-log-'));
const LOG = join(dir, 'console.log');

const ACCOUNT = 123456788;
process.env.DSN_ACCOUNT_ID = String(ACCOUNT);
process.env.DSN_DEADLOCK_LOG = LOG;
process.env.PORT = '0';

// The real shape, taken from the log patterns gamelog.js documents.
const lobbyOpen = `
10/05 12:27:41 Lobby 174100000000000001 for Match 100000901 created
10/05 12:27:44 OnGameStateChanged: GameInProgress (7)
`;
const lobbyClosed = `
10/05 12:27:41 Lobby 174100000000000001 for Match 100000901 created
10/05 12:45:38 Lobby 174100000000000001 for Match 100000901 destroyed
10/05 12:45:40 OnGameStateChanged: GameInProgress (7)
`;

/**
 * The API answers everything EXCEPT the active match, which is the real
 * situation this wiring exists for: /v1/matches/active is the in-game watch
 * tab, so it returns [] for an ordinary account even mid-match.
 */
globalThis.fetch = async url => {
  const u = String(url);
  const json = u.includes('/matches/active') ? []
    : u.includes('/players/steam') ? [{ account_id: ACCOUNT, personaname: 'operator' }]
    : u.includes('/players/rank') ? [{ account_id: ACCOUNT, rank: 0, subrank: 0 }]
    : u.includes('/match-history') ? [{
        match_id: 100000901, start_time: Math.floor(Date.now() / 1000) - 3600,
        game_mode: 1, match_mode: 1, player_team: 0, match_result: 0,
        player_kills: 9, player_deaths: 3, player_assists: 5,
        net_worth: 50000, last_hits: 150, denies: 10,
        match_duration_s: 1800, hero_id: 15, abandoned_time_s: null
      }]
    : [];
  return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
};

const mod = await import('../proxy/server.js');

test('an open lobby puts the document in MATCH even though the API reports no match', async () => {
  writeFileSync(LOG, lobbyOpen);
  await mod.doRefresh();

  assert.equal(mod.current.phase, 'MATCH',
    'the log said a lobby is open and the state is GameInProgress');
  assert.equal(String(mod.current.matchId), '100000901',
    'the match id must come from the log, since the API never named it');
  // This is the point of the wiring: overlay/machine.js returns 'sweep' only on
  // a transition INTO MATCH, so a phase stuck at IDLE means no transition ever
  // fires on a real stream.
  assert.notEqual(mod.current.phase, 'IDLE');
});

test('the operator row is still populated when the roster is not', async () => {
  writeFileSync(LOG, lobbyOpen);
  await mod.doRefresh();

  assert.ok(mod.current.operator, 'four of the five chiron turns need this row');
  assert.equal(mod.current.operator.accountId, ACCOUNT);
  assert.equal(mod.current.teams.length, 2, 'shape parity holds');
  assert.deepEqual(mod.current.teams.map(t => t.players.length), [0, 0],
    'the API cannot supply a live roster, and the overlay renders that as dashes');
});

test('a destroyed lobby returns to IDLE, which is what fires the ident', async () => {
  writeFileSync(LOG, lobbyOpen);
  await mod.doRefresh();
  assert.equal(mod.current.phase, 'MATCH', 'precondition');

  writeFileSync(LOG, lobbyClosed);
  await mod.doRefresh();

  // The hideout reports GameInProgress too — the trailing state line above is
  // deliberately that — so only the destroyed lobby may end the match.
  assert.equal(mod.current.phase, 'IDLE');
  assert.equal(mod.current.matchId, null);
});

test('no log means the previous behaviour, not a broken one', async () => {
  // Without -condebug the file never exists. That must degrade to the API-only
  // path rather than throwing or claiming a match.
  rmSync(LOG, { force: true });
  await mod.doRefresh();

  assert.equal(mod.current.phase, 'IDLE');
  assert.ok(mod.current.operator, 'the idle document is still built');
  assert.equal(mod.current.stale, undefined, 'this is a normal idle, not a failure');
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
