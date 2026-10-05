import { writeFileSync, mkdirSync } from 'node:fs';

const API = 'https://api.deadlock-api.com/v1';
const SAMPLE = 60;

async function get(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

mkdirSync('fixtures', { recursive: true });

// 1. a live match, for the roster shape
const active = await get('/matches/active');
const match = active.find(m => m.players?.length === 12);
if (!match) throw new Error('no 12-player match in the active list right now; retry');
writeFileSync('fixtures/active.sample.json', JSON.stringify(match, null, 2));
console.log('active.sample.json      match', match.match_id);

const ids = match.players.map(p => p.account_id);

// 2 + 3. batch profile and rank for that roster.
//
// The steam endpoint returns far more than the overlay consumes: `friends`
// (an array of {account_id, friend_since} — over a thousand records across a
// single roster), plus `realname` and `countrycode`. None of it is read by any
// code in this project, and committing it would put a social graph of ~1,000
// third parties who were never in the match into git history permanently.
// So project down to exactly the fields the overlay uses.
const STEAM_FIELDS = ['account_id', 'personaname', 'avatar', 'avatarmedium'];
const pick = (row, fields) =>
  Object.fromEntries(fields.filter(f => f in row).map(f => [f, row[f]]));

const steamRaw = await get(`/players/steam?account_ids=${ids.join(',')}`);
writeFileSync('fixtures/steam.sample.json',
  JSON.stringify(steamRaw.map(r => pick(r, STEAM_FIELDS)), null, 2));

// rank carries no personal data beyond the id, but `last_match` is a large
// nested object the fixtures never read.
const RANK_FIELDS = ['account_id', 'badge', 'rank', 'subrank'];
const rankRaw = await get(`/players/rank?account_ids=${ids.join(',')}`);
writeFileSync('fixtures/rank.sample.json',
  JSON.stringify(rankRaw.map(r => pick(r, RANK_FIELDS)), null, 2));

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

writeFileSync('fixtures/match-history.sample.json', JSON.stringify(sample, null, 2));
console.log(`match-history.sample.json  ${sample.length} of ${full.length} entries, `
          + `${abandons.length} abandons retained`);
