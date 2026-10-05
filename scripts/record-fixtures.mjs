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
 * These are recordings of a real account, so they carry a real person's id and
 * persona name, and they are committed. Projecting the fields down removes the
 * social graph but keeps the identity, so the identity is replaced here instead
 * — at the write boundary, one place, so a later re-record cannot quietly put a
 * real person back into git history.
 *
 * Ids are remapped consistently across the three files, because the state
 * builder joins steam, rank and history on account_id. Stats, ranks, heroes and
 * timestamps are untouched: they are what the fixtures exist to exercise, and
 * none of them identifies anyone on their own.
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



// An account to record from. /matches/active is only used to find one — the
// fixtures no longer need a roster, so nothing from the match itself is kept.
const active = await get('/matches/active');
const subject = active.find(m => m.players?.length)?.players?.[0]?.account_id;
if (!subject) throw new Error('no active match to pick an account from; retry');

// ONE account, not twelve. The fixtures used to carry a full 12-player roster
// because the overlay rendered one; nothing does now, and recording eleven more
// people's profiles to use one of them is data this project has no reason to
// hold. See the anonymisation note above — that covers what is kept, this
// covers what is never fetched.
//
// The steam endpoint returns far more than the overlay consumes: `friends` (an
// array of {account_id, friend_since}, over a thousand records for one
// account), plus `realname` and `countrycode`. None of it is read, so the
// response is projected down to the two fields that are.
const STEAM_FIELDS = ['account_id', 'personaname'];
const RANK_FIELDS = ['account_id', 'badge', 'rank', 'subrank'];
const pick = (row, fields) =>
  Object.fromEntries(fields.filter(f => f in row).map(f => [f, row[f]]));

const steamRaw = await get(`/players/steam?account_ids=${subject}`);
writeSample('steam.sample.json', steamRaw.map(r => pick(r, STEAM_FIELDS)));

// rank carries no personal data beyond the id, but `last_match` is a large
// nested object the fixtures never read.
const rankRaw = await get(`/players/rank?account_ids=${subject}`);
writeSample('rank.sample.json', rankRaw.map(r => pick(r, RANK_FIELDS)));

console.log(`steam/rank.sample.json   1 account (projected to `
          + `${STEAM_FIELDS.length}/${RANK_FIELDS.length} fields)`);

// The history, down-sampled but keeping every abandon — abandonCount has a
// 0-sentinel bug that only a real abandon catches.
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
