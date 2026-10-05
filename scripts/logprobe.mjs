/**
 * Watches Deadlock's console.log and reports the lines that look like they
 * carry match state.
 *
 * This exists because the overlay cannot see your live match any other way.
 * deadlock-api's only live source is /v1/matches/active, which is the in-game
 * watch tab — "limited to the top 200 matches" by its own documentation — so an
 * ordinary account's match never appears there. The game's own log does know,
 * and the proxy runs on the same machine as the game.
 *
 * Run this, play a match, and send the output. The parser gets written against
 * what the log actually prints rather than against a guess at its format.
 *
 *   1. Steam -> Deadlock -> Properties -> Launch Options -> -condebug
 *   2. npm run logprobe
 *   3. launch Deadlock and get into a match
 *
 * Nothing here is uploaded anywhere; it only reads a local file and prints.
 */
import { existsSync, statSync, createReadStream, watch } from 'node:fs';
import { DEADLOCK_LOG } from '../proxy/config.js';

const LOG = process.argv[2] ?? DEADLOCK_LOG;

// Deliberately broad. The point is to discover the vocabulary, not to filter to
// terms already assumed — a pattern that only matches what is expected teaches
// nothing when the expectation is wrong.
const INTERESTING = /match|lobby|server|connect|session|citadel|gameplay|hero|team|spectat|gc\b|party|queue/i;

// Anything with a long run of digits is a candidate id.
const IDLIKE = /\b\d{6,}\b/;

let offset = 0;
let seen = 0;

function emit(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  const isId = IDLIKE.test(trimmed);
  if (!isId && !INTERESTING.test(trimmed)) return;
  seen++;
  // Flag id-bearing lines: those are the ones a parser will key off.
  console.log(`${isId ? 'ID  ' : '    '}${trimmed.slice(0, 200)}`);
}

function readFrom(start) {
  return new Promise(resolve => {
    let buf = '';
    createReadStream(LOG, { start, encoding: 'utf8' })
      .on('data', chunk => {
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        lines.forEach(emit);
      })
      .on('end', resolve)
      .on('error', resolve);
  });
}

async function poll() {
  if (!existsSync(LOG)) return;
  const size = statSync(LOG).size;
  // A truncated file means the game restarted and began a fresh log.
  if (size < offset) { console.log('--- log truncated, game restarted ---'); offset = 0; }
  if (size > offset) {
    await readFrom(offset);
    offset = size;
  }
}

console.log(`watching ${LOG}`);
if (!existsSync(LOG)) {
  console.log('');
  console.log('  That file does not exist yet, which means -condebug is not set.');
  console.log('  Steam -> right-click Deadlock -> Properties -> Launch Options -> -condebug');
  console.log('  Then launch the game. This will start reporting as soon as the file appears.');
  console.log('');
} else {
  offset = statSync(LOG).size;      // only new lines, not the whole backlog
  console.log(`(starting at ${offset} bytes — only new lines are shown)`);
}

setInterval(poll, 1000);
try { watch(LOG, poll); } catch { /* the file may not exist yet; the poll covers it */ }

process.on('SIGINT', () => {
  console.log(`\n${seen} candidate lines seen.`);
  process.exit(0);
});
