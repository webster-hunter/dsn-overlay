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

// 2 + 3. batch profile and rank for that roster
writeFileSync('fixtures/steam.sample.json',
  JSON.stringify(await get(`/players/steam?account_ids=${ids.join(',')}`), null, 2));
writeFileSync('fixtures/rank.sample.json',
  JSON.stringify(await get(`/players/rank?account_ids=${ids.join(',')}`), null, 2));
console.log('steam/rank.sample.json  12 players');

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
