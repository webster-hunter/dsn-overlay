import { writeFileSync, mkdirSync } from 'node:fs';

const API = 'https://api.deadlock-api.com/v1';
const SAMPLE = 60;

async function get(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

mkdirSync('fixtures', { recursive: true });
/**
 * Everything written to fixtures/ goes through here.
 *
 * The committed fixtures are a real match, which means twelve real people's
 * account ids and persona names. Projecting the fields down (below) removed the
 * social graph but kept the identities, and these files are committed — so they
 * are anonymised at the write boundary instead. One place, so a later re-record
 * cannot quietly put real people back into git history.
 *
 * Ids are remapped consistently across all four files, because the state
 * builder joins the roster to steam, rank and history on account_id. Stats,
 * ranks, heroes, teams and timestamps are untouched: they are what the fixtures
 * exist to exercise, and none of them identifies anyone on their own.
 */
const accounts = new Map();
const matches = new Map();
let nextAccount = 900000001;
let nextMatch = 100000001;

const PERSONAS = [
  'Pylon', 'Trenchcoat', 'Mossy', 'Ivorybill', 'Saltmarsh', 'Quietly',
  'Deepwater', 'Pennyroyal', 'Harrier', 'Clementine', 'Fathom', 'Sorrel',
  'Lanternfly', 'Woodsmoke', 'Verdigris', 'Thimble'
];

const remap = (store, real, next) => {
  if (!store.has(real)) store.set(real, next());
  return store.get(real);
};

function anonymise(node) {
  if (Array.isArray(node)) return node.map(anonymise);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'account_id' && typeof v === 'number') {
        out[k] = remap(accounts, v, () => nextAccount++);
      } else if (k === 'match_id' && typeof v === 'number') {
        out[k] = remap(matches, v, () => nextMatch++);
      } else if (k !== 'personaname') {
        out[k] = anonymise(v);
      }
    }
    // After the id is mapped, so a given player keeps one name across files.
    if ('personaname' in node) out.personaname = PERSONAS[(out.account_id ?? 0) % PERSONAS.length];
    return out;
  }
  return node;
}

/** Writes an anonymised sample. Never call writeFileSync for fixtures directly. */
function writeSample(name, data) {
  const NL = String.fromCharCode(10);
  writeFileSync(`fixtures/${name}`, JSON.stringify(anonymise(data), null, 2) + NL);
}



// 1. a live match, for the roster shape
const active = await get('/matches/active');
const match = active.find(m => m.players?.length === 12);
if (!match) throw new Error('no 12-player match in the active list right now; retry');
writeSample('active.sample.json', match);
console.log('active.sample.json      match', matches.get(match.match_id), '(anonymised)');

const ids = match.players.map(p => p.account_id);

// 2 + 3. batch profile and rank for that roster.
//
// The steam endpoint returns far more than the overlay consumes: `friends`
// (an array of {account_id, friend_since} — over a thousand records across a
// single roster), plus `realname` and `countrycode`. None of it is read by any
// code in this project, and committing it would put a social graph of ~1,000
// third parties who were never in the match into git history permanently.
// So project down to exactly the fields the overlay uses.
// The board shows hero icons now, so avatars are not rendered anywhere and
// are no longer recorded. `personaname` stays: the chiron's Matchup turn
// still names opponents.
const STEAM_FIELDS = ['account_id', 'personaname'];
const pick = (row, fields) =>
  Object.fromEntries(fields.filter(f => f in row).map(f => [f, row[f]]));

const steamRaw = await get(`/players/steam?account_ids=${ids.join(',')}`);
writeSample('steam.sample.json', steamRaw.map(r => pick(r, STEAM_FIELDS)));

// rank carries no personal data beyond the id, but `last_match` is a large
// nested object the fixtures never read.
const RANK_FIELDS = ['account_id', 'badge', 'rank', 'subrank'];
const rankRaw = await get(`/players/rank?account_ids=${ids.join(',')}`);
writeSample('rank.sample.json', rankRaw.map(r => pick(r, RANK_FIELDS)));

console.log(`steam/rank.sample.json  12 players (projected to `
          + `${STEAM_FIELDS.length}/${RANK_FIELDS.length} fields)`);

// 4. one player's history, down-sampled but keeping every abandon
const subject = ids[0];
const full = await get(`/players/${subject}/match-history`);
const abandons = full.filter(r => typeof r.abandoned_time_s === 'number' && r.abandoned_time_s > 0);
const recent = full
  .slice()
  .sort((a, b) => b.start_time - a.start_time)
  .slice(0, SAMPLE);
const seen = new Set(recent.map(r => r.match_id));
const sample = recent.concat(abandons.filter(r => !seen.has(r.match_id)));

writeSample('match-history.sample.json', sample);
console.log(`match-history.sample.json  ${sample.length} of ${full.length} entries, `
          + `${abandons.length} abandons retained`);

console.log(`
anonymised: ${accounts.size} account ids, ${matches.size} match ids, `
          + `${Math.min(accounts.size, PERSONAS.length)} persona names replaced`);
