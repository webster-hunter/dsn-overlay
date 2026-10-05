# DSN Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an ESPN-styled Twitch overlay for Valve's *Deadlock* that renders as a single OBS browser source at 1920×1080, driven automatically by match state, with a 12-player split-flap statistics rail and a rolling chiron.

**Architecture:** Two processes. A small Node proxy owns all contact with `api.deadlock-api.com`: it detects the operator's live match, fetches and *reduces* the per-player history, and exposes one route, `GET /state`, returning a single JSON document. The overlay is a static page that polls that route and renders it — it never calls the Deadlock API, never retries, never orchestrates. That constraint is what makes the whole visual layer developable and testable against a fixture file with no network and no game running.

**Tech Stack:** Node 20+ (for stable `node:test` and global `fetch`), vanilla ES modules, plain CSS. **Zero runtime dependencies.** Test runner is Node's built-in `node --test`. No bundler, no framework, no build step — editing a file and refreshing the browser source is the whole loop.

**Spec:** `docs/superpowers/specs/2026-10-04-dsn-overlay-design.md`

## Global Constraints

- **Node 20+.** Required for stable `node:test` and global `fetch`. Verified on v24.14.0.
- **The test script must use a glob, not a directory:** `node --test "tests/**/*.test.js"`.
  A bare `node --test tests/` is **broken on Node 24 / Windows** — it treats `tests`
  as a single test file and reports a spurious failure. Verified by experiment:
  the glob form discovers nested files, exits 0 on pass and 1 on failure, and
  survives npm's shell quoting.
- **OBS Studio 31.0 or newer.** Current stable (32.2.2) ships Chromium 127, which
  covers every CSS feature this plan uses — `color-mix()` needs 111 and `:has()`
  needs 105, so older OBS builds would render the faction bands invisible.
- **Zero runtime dependencies.** `package.json` must have no `dependencies` field. Dev-only tooling is also disallowed — Node's built-ins cover testing.
- **`"type": "module"`** in `package.json`. All JS is ESM; no `require`.
- **The overlay must never call `api.deadlock-api.com`.** Only `proxy/deadlock.js` performs outbound requests to it.
- **Rate ceiling: `/v1/players/rank` is 20 req/min per IP.** Fetch once per match, never poll. All other endpoints used here are 100 req/s except `/v1/analytics/*` (200 req/min shared) and `/v1/commands/resolve` (60 req/60s).
- **Constant flap cell count: 11 value cells, 8 header cells.** Built once at mount, never rebuilt. A value needing 12 characters abbreviates or does not ship.
- **Right-justified flap values.** Overflow truncates from the *left* (`slice(-n)`), keeping the least-significant end.
- **Canvas size is exactly 1920×1080.** Rail 403px (21%), chiron 135px (12.5%), logo bay 211px (11% of chiron width), facecam 403×227 (16:9), board rows 48px.
- **Logo is bone `#FFEFD7`, symbol only, no wordmark.** Rotation 90s/revolution, blink every 10s.
- **Never render a hole.** Every failure path degrades to something a viewer reads as intentional. No spinners, no empty panels, no error text in the browser source.
- **Faction names are config, bound to colour not team index:** amber = `Hidden King`, sapphire = `Archmother`.
- **Pending decision — palette source.** Implement `--team-amber` / `--team-sapphire` as tokens so the pair can be swapped in one place. Default to the citadel pair (`#D4860B` / `#4D75C3`); the brighter generic-data pair (`#E7B659` / `#5B79E6`) is the alternative.
- **Pending verification — Team0 = amber.** `proxy/config.js` must expose `TEAM0_IS_AMBER = true` as a single named constant with a comment pointing at spec §4.2, so day-one correction is a one-line change.

## Review Focus

These are input classes the spec implies but does not enumerate. Each line names the input and the behaviour a reasonable person expects; each has a test assigned to the task that owns the code.

1. **A persona name of 32 full-width CJK characters or emoji** — must shrink to the 8px floor then ellipsis, and must never widen the rail or overflow its column. *(Task 8, Step 9)*
2. **A player with fewer than 11 matches of history** (new or smurf account) — FORM must pad with blanks rather than crash, misalign, or repeat results. *(Task 4, Step 7)*
3. **Unscored, in-progress, or abandoned history entries** — must be excluded from win/loss rather than silently counted as losses. The API's `not_scored` matches and null `match_result` both occur. *(Task 4, Step 5)*
4. **A roster player absent from the batch `steam` or `rank` response** (private profile, or the batch simply omits them) — the row must render with placeholders and keep the board at 12 rows, not drop the row or shift the factions. *(Task 6, Step 7)*
5. **A rank tier index outside 0–11**, as will happen the patch Valve adds a tier — must render a safe fallback, never `undefined 6`. *(Task 3, Step 5)*

---

## File Structure

```
package.json                 no deps, type:module, scripts
proxy/
  config.js                  operator identity, faction map, tunables, TEAM0_IS_AMBER
  deadlock.js                the only outbound HTTP; endpoint wrappers
  rank.js                    PURE  {rank,subrank} -> name + tier colour
  derive.js                  PURE  history[] -> per-player derived stats
  registry.js                PURE  stat definitions: compute, minSample, salience
  state.js                   PURE  parts -> the /state document
  cache.js                   TTL stores (per-match, per-hour)
  server.js                  node:http, routes /state and /fixture
overlay/
  index.html                 the browser source page
  tokens.css                 GENERATED by scripts/tokens.mjs — committed
  overlay.css                layout + components
  fit.js                     PURE-ish  name auto-fit with injected measurer
  flap.js                    fixed-cell split-flap driver
  board.js                   roster rail
  chiron.js                  spine, rolling groups, persistent zone
  logo.js                    composites the three logo SVG layers
  machine.js                 client state machine + transition triggers
  app.js                     polls /state, dispatches to components
  fonts/                     vendored .otf  (3 families)
  logo/                      vendored .svg  (3 layers)
scripts/
  tokens.mjs                 /v1/assets/colors  -> overlay/tokens.css
  vendor.mjs                 downloads fonts + logo layers
  record-fixtures.mjs        live API -> fixtures/*.json (reduced)
tests/
  rank.test.js  derive.test.js  registry.test.js  state.test.js
  flap.test.js  fit.test.js
fixtures/
  match-history.sample.json  active.sample.json  steam.sample.json
  rank.sample.json           state.sample.json
```

**Why these boundaries.** Everything pure sits in its own file with no I/O, so it is testable with `node --test` and no DOM: `rank`, `derive`, `registry`, `state`, `fit`, and the arithmetic inside `flap`. All network access is confined to `deadlock.js`. The overlay files split by *responsibility* (board / chiron / logo / machine), not by technical layer, so a change to the chiron touches one file.

---

### Task 1: Scaffold and vendored assets

**Files:**
- Create: `package.json`
- Create: `scripts/tokens.mjs`
- Create: `scripts/vendor.mjs`
- Create: `overlay/tokens.css` (generated, committed)
- Create: `overlay/fonts/` and `overlay/logo/` (generated, committed)
- Test: `tests/tokens.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `overlay/tokens.css` defining CSS custom properties including `--team1-color`, `--team2-color`, `--base-text`, `--color-gold`; vendored files `overlay/fonts/{radiance-semibold,radiance-bold,radiancem-semibold,reaver-bold}.otf` and `overlay/logo/{outer,inner_noeye,eye}.svg`. npm scripts `test`, `tokens`, `vendor`, `serve`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "dsn-overlay",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test \"tests/**/*.test.js\"",
    "tokens": "node scripts/tokens.mjs",
    "vendor": "node scripts/vendor.mjs",
    "serve": "node proxy/server.js"
  }
}
```

There is deliberately no `dependencies` key. If a later task wants one, that is a signal to reconsider, not to add it.

- [ ] **Step 2: Write the failing test**

Create `tests/tokens.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const CSS = 'overlay/tokens.css';

test('tokens.css exists and was generated', () => {
  assert.ok(existsSync(CSS), 'run `npm run tokens` to generate it');
});

test('tokens.css defines the colours the overlay depends on', () => {
  const css = readFileSync(CSS, 'utf8');
  for (const name of ['--team1-color', '--team2-color', '--base-text', '--color-gold']) {
    assert.match(css, new RegExp(`${name}\\s*:\\s*#[0-9A-Fa-f]{6}`), `missing ${name}`);
  }
});

test('vendored fonts and logo layers are present', () => {
  for (const f of [
    'overlay/fonts/radiance-semibold.otf',
    'overlay/fonts/radiancem-semibold.otf',
    'overlay/fonts/reaver-bold.otf',
    'overlay/logo/outer.svg',
    'overlay/logo/inner_noeye.svg',
    'overlay/logo/eye.svg'
  ]) {
    assert.ok(existsSync(f), `missing ${f} — run \`npm run vendor\``);
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `tokens.css exists` asserts false.

- [ ] **Step 4: Write `scripts/tokens.mjs`**

The API returns `{ name: {red,green,blue,alpha} }` for 184 colours. Convert every one to a kebab-case custom property so later tasks can reach for any Deadlock colour without another fetch.

```js
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = 'https://api.deadlock-api.com/v1/assets/colors';

const hex = c =>
  '#' + [c.red, c.green, c.blue].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();

const res = await fetch(URL);
if (!res.ok) throw new Error(`colors fetch failed: ${res.status}`);
const colors = await res.json();

const lines = Object.keys(colors).sort().map(name => {
  const prop = '--' + name.replace(/_/g, '-');
  return `  ${prop}: ${hex(colors[name])};`;
});

const out = `/* GENERATED by scripts/tokens.mjs — do not edit by hand.
   Source: ${URL} (Valve's citadel_base_styles.css Panorama palette)
   Regenerate after a Deadlock patch: npm run tokens */
:root {
${lines.join('\n')}

  /* --- layout, from spec section 4.1 --- */
  --rail-width: 403px;
  --chiron-height: 135px;
  --logo-bay-width: 211px;
  --row-height: 48px;
  --name-size: 14px;
  --name-floor: 8px;

  /* --- flap, from spec section 5.3 --- */
  --flap-cells: 11;
  --flap-head: 8;
  --flap-cell-w: 15px;
  --flap-cell-h: 20px;
  --flap-type: 12px;
  --flap-seam: 1.2px;
  --flap-seam-op: 0.34;

  /* --- chiron, from spec section 6.1 --- */
  --chiron-hold: 9s;
  --chiron-groups: 4;

  /* --- logo + transitions, from spec sections 6.4 and 6.5 --- */
  --mark-color: #FFEFD7;
  --mark-rev: 90s;
  --mark-blink: 10s;
  --xition-sweep: 1.1s;
  --xition-ident: 1.9s;

  /* --- team palette. Swap this pair to change palette source.
         citadel (default):      #D4860B / #4D75C3
         generic-data (brighter): #E7B659 / #5B79E6   --- */
  --team-amber: var(--team1-color);
  --team-sapphire: var(--team2-color);
}
`;

mkdirSync('overlay', { recursive: true });
writeFileSync('overlay/tokens.css', out);
console.log(`wrote overlay/tokens.css — ${Object.keys(colors).length} colours`);
```

- [ ] **Step 5: Write `scripts/vendor.mjs`**

Fonts and the logo are vendored rather than hot-linked: a broadcast must not depend on a third-party bucket being reachable.

```js
import { writeFileSync, mkdirSync } from 'node:fs';

const FONT_BASE = 'https://assets-bucket.deadlock-api.com/assets-api-res/fonts/';
const LOGO_BASE = 'https://assets-bucket.deadlock-api.com/assets-api-res/images/main_menu/';

const FONTS = [
  'radiance-semibold.otf',
  'radiance-bold.otf',
  'radiancem-semibold.otf',
  'reaver-bold.otf'
];

// Composite = outer + inner_noeye + eye. deadlock_logo_inner.svg (10 paths)
// is the inner form WITH the eye baked in; we want the eye separable, so skip it.
const LOGO = {
  'outer.svg': 'deadlock_logo_outer.svg',
  'inner_noeye.svg': 'deadlock_logo_inner_noeye.svg',
  'eye.svg': 'deadlock_logo_eye.svg'
};

async function grab(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`  ${dest}  ${buf.length} bytes`);
}

mkdirSync('overlay/fonts', { recursive: true });
mkdirSync('overlay/logo', { recursive: true });

console.log('fonts:');
for (const f of FONTS) await grab(FONT_BASE + f, `overlay/fonts/${f}`);

console.log('logo layers:');
for (const [dest, src] of Object.entries(LOGO)) await grab(LOGO_BASE + src, `overlay/logo/${dest}`);
```

- [ ] **Step 6: Generate the assets**

Run: `npm run tokens && npm run vendor`
Expected: `wrote overlay/tokens.css — 184 colours`, then seven files listed with byte counts. `radiancem-semibold.otf` should be about 3.9KB — it holds only the ten digits and a space, which is why it is the numeral font.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 3 tests.

- [ ] **Step 8: Commit**

```bash
git add package.json scripts/ overlay/tokens.css overlay/fonts/ overlay/logo/ tests/tokens.test.js
git commit -m "feat: scaffold project and vendor Deadlock tokens, fonts and logo layers"
```

---

### Task 2: Fixture recorder

**Files:**
- Create: `scripts/record-fixtures.mjs`
- Create: `fixtures/*.json` (generated, committed)
- Test: `tests/fixtures.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `fixtures/match-history.sample.json` (an array of ~60 `PlayerMatchHistoryEntry` objects), `fixtures/active.sample.json`, `fixtures/steam.sample.json`, `fixtures/rank.sample.json`. Every later pure-function test reads these.

Fixtures are *recorded from the live API*, not hand-written. The response shapes are fiddly enough that hand-rolled mocks would encode our misunderstandings rather than the API's behaviour — which is exactly how the two bugs below got caught.

- [ ] **Step 1: Write the failing test**

Create `tests/fixtures.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const load = f => JSON.parse(readFileSync(`fixtures/${f}`, 'utf8'));

test('match-history fixture has the fields derive.js needs', () => {
  assert.ok(existsSync('fixtures/match-history.sample.json'),
    'run `npm run fixtures`');
  const rows = load('match-history.sample.json');
  assert.ok(rows.length >= 30, `want >= 30 entries, got ${rows.length}`);
  for (const f of ['match_id', 'start_time', 'player_team', 'match_result',
                   'player_kills', 'player_deaths', 'net_worth', 'last_hits',
                   'denies', 'hero_id', 'match_duration_s', 'abandoned_time_s']) {
    assert.ok(f in rows[0], `entry missing ${f}`);
  }
});

test('match-history fixture abandon coverage (informational)', () => {
  const rows = load('match-history.sample.json');
  const ab = rows.filter(r => typeof r.abandoned_time_s === 'number' && r.abandoned_time_s > 0);
  // Deliberately NOT an assertion. Abandons occur at ~0.09%, so whether the
  // recorded subject has one is a roster lottery, and a suite that fails on
  // unlucky data teaches people to re-run instead of read. The real gate for
  // the 0-vs-null sentinel is Task 4's synthetic tests, which are
  // deterministic and pin it from both sides.
  console.log(`      fixture abandons: ${ab.length} of ${rows.length} entries`);
  assert.ok(Array.isArray(rows), 'fixture parses');
});

test('active fixture carries a 12-player roster', () => {
  const m = load('active.sample.json');
  assert.equal(m.players.length, 12);
  for (const f of ['account_id', 'team', 'hero_id']) assert.ok(f in m.players[0]);
});

test('rank fixture carries tier and subrank', () => {
  const r = load('rank.sample.json')[0];
  assert.equal(typeof r.rank, 'number');
  assert.equal(typeof r.subrank, 'number');
});

test('steam fixture carries what the board renders', () => {
  const rows = load('steam.sample.json');
  assert.equal(rows.length, 12);
  for (const r of rows) {
    assert.equal(typeof r.account_id, 'number');
    assert.equal(typeof r.personaname, 'string');
    assert.ok(r.personaname.length > 0, 'a name must never be empty');
  }
});

test('steam fixture commits no unused personal data', () => {
  // The live endpoint also returns `friends` (1,000+ {account_id, friend_since}
  // records across one roster), `realname` and `countrycode`. The overlay reads
  // none of them, and committing them would put a social graph of third parties
  // who were never in the match into git history permanently. The recorder
  // projects the response; this stops that projection being dropped.
  const allowed = new Set(['account_id', 'personaname', 'avatar', 'avatarmedium']);
  for (const row of load('steam.sample.json')) {
    for (const key of Object.keys(row)) {
      assert.ok(allowed.has(key),
        `steam fixture leaked "${key}" — the recorder must project to ${[...allowed].join(', ')}`);
    }
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/fixtures.test.js`
Expected: FAIL — fixture files do not exist.

- [ ] **Step 3: Write `scripts/record-fixtures.mjs`**

Note the deliberate down-sampling. A single player's live history is **2.54 MB across 4,348 entries**; committing that would make the repo unpleasant and the tests slow. We keep a slice, but *force-include* the rare abandoned matches so the abandon test has something to find.

```js
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
```

- [ ] **Step 4: Add the npm script**

In `package.json`, add to `scripts`:

```json
"fixtures": "node scripts/record-fixtures.mjs"
```

- [ ] **Step 5: Record the fixtures**

Run: `npm run fixtures`
Expected: four files written. If it reports `no 12-player match in the active list right now`, run it again — the endpoint holds ~150 live matches and the composition changes constantly.

If the chosen subject has zero abandons, the second test will fail. Re-run `npm run fixtures`; it picks `ids[0]` of whatever match it found, so a different roster gives a different subject.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/fixtures.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add scripts/record-fixtures.mjs fixtures/ tests/fixtures.test.js package.json
git commit -m "feat: record reduced API fixtures from live responses"
```

---

### Task 3: Rank formatting

**Files:**
- Modify: `scripts/tokens.mjs` (append a second fetch + a second output file)
- Create: `proxy/rank-tiers.js` (GENERATED by that script, committed)
- Create: `proxy/rank.js`
- Test: `tests/rank.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `rank-tiers.js` exports `TIERS` — array of 12 `{ tier, name, color }`,
    index = tier, **generated from `/v1/assets/ranks`**.
  - `rank.js` re-exports `TIERS` and adds the logic below.
  - `rankLabel(rank: number, subrank: number) → string` — e.g. `'ASCENDANT 6'`, uppercase, max 11 chars.
  - `tierColor(rank: number) → string` — hex, falls back to `'#FFED79'`.

The 12 tiers and the 11-character ceiling are the reason the board has 11 cells. `Ritualist` and `Ascendant` are both 9 characters, so with a space and a single-digit subrank they are exactly 11.

**The tier colours are generated, not typed — and that is a fix, not a
precaution.** An earlier draft of this plan hardcoded all twelve. When they were
finally checked against `/v1/assets/ranks`, **eleven of the twelve were wrong**:
Eternus is `#5CE9A9`, a bright green, rather than the gold that had been invented
for it; Ritualist is `#EE4F57` (red) rather than purple; Emissary `#B47FEB`
(purple) rather than brown. Only Ascendant was right, because it was the single
value anyone had actually looked up.

That failure mode is invisible to review — a fabricated palette renders
plausibly, and a reviewer has no ground truth to check it against. So the table
is emitted by the same script that already generates `tokens.css` from the
sibling endpoint. That makes it true by construction and impossible to mistype.

- [ ] **Step 1: Write the failing test**

Create `tests/rank.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, rankLabel, tierColor } from '../proxy/rank.js';

test('there are exactly 12 tiers', () => {
  assert.equal(TIERS.length, 12);
  assert.equal(TIERS[0].name, 'Obscurus');
  assert.equal(TIERS[11].name, 'Eternus');
});

test('Archon, Alchemist and Arcanist are not tiers any more', () => {
  const names = TIERS.map(t => t.name);
  for (const gone of ['Archon', 'Alchemist', 'Arcanist']) {
    assert.ok(!names.includes(gone), `${gone} is stale and must not appear`);
  }
});

test('every tier colour is a usable 6-digit hex', () => {
  for (const t of TIERS) {
    assert.match(t.color, /^#[0-9A-F]{6}$/,
      `tier ${t.tier} (${t.name}) colour "${t.color}" is not a 6-digit hex`);
  }
});

test('tier indices are 0..11 with no gaps, in order', () => {
  assert.deepEqual(TIERS.map(t => t.tier), [0,1,2,3,4,5,6,7,8,9,10,11],
    'rank.js indexes TIERS by the API\'s `rank` field, so order is load-bearing');
});

test('the tier table is generated, not hand-written', async () => {
  // An earlier draft hardcoded these and got 11 of 12 colours wrong, which no
  // review could catch without querying the API. The provenance header is the
  // cheap guard against someone "simplifying" the generator away again.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('proxy/rank-tiers.js', 'utf8');
  assert.match(src, /GENERATED by scripts\/tokens\.mjs/,
    'proxy/rank-tiers.js must be generated — run `npm run tokens`');
  assert.match(src, /assets\/ranks/, 'the header must name its source endpoint');
});

test('spot-check two colours against the live API values', () => {
  // Recorded from /v1/assets/ranks on 2026-10-04. Eternus is the canary: the
  // hand-written table had it as a gold (#E0C060) when it is actually a bright
  // green, so if this reverts to gold the generator is not reading `color`.
  const byName = Object.fromEntries(TIERS.map(t => [t.name, t.color]));
  assert.equal(byName.Eternus, '#5CE9A9');
  assert.equal(byName.Ascendant, '#C39751');
});

test('labels are uppercase and fit 11 cells', () => {
  assert.equal(rankLabel(10, 6), 'ASCENDANT 6');
  assert.equal(rankLabel(6, 1), 'RITUALIST 1');
  assert.equal(rankLabel(8, 2), 'ORACLE 2');
  for (let r = 0; r < 12; r++) {
    for (let s = 1; s <= 6; s++) {
      assert.ok(rankLabel(r, s).length <= 11,
        `rankLabel(${r},${s}) = "${rankLabel(r, s)}" exceeds 11 cells`);
    }
  }
});

test('the two longest tiers are exactly 11 characters', () => {
  assert.equal(rankLabel(6, 6).length, 11);
  assert.equal(rankLabel(10, 6).length, 11);
});

// Review Focus 5: an unknown tier index, as when Valve adds a tier
test('an out-of-range tier degrades safely, never "undefined"', () => {
  for (const bad of [12, 99, -1, null, undefined, NaN]) {
    const label = rankLabel(bad, 3);
    assert.doesNotMatch(label, /undefined|NaN|null/, `rankLabel(${bad},3) = "${label}"`);
    assert.ok(label.length <= 11);
  }
  assert.equal(rankLabel(12, 3), 'UNRANKED');
  assert.match(tierColor(12), /^#[0-9A-F]{6}$/i);
});

test('real fixture ranks all format', async () => {
  const { readFileSync } = await import('node:fs');
  const rows = JSON.parse(readFileSync('fixtures/rank.sample.json', 'utf8'));
  for (const r of rows) {
    const label = rankLabel(r.rank, r.subrank);
    assert.ok(label.length <= 11, `${label} too long`);
    assert.doesNotMatch(label, /undefined|NaN/);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/rank.test.js`
Expected: FAIL — cannot find module `../proxy/rank.js`.

- [ ] **Step 2b: Generate the tier table**

`scripts/tokens.mjs` already exists from Task 1 and already fetches the sibling
`/v1/assets/colors` endpoint. Append this to the end of it — same script because
it is the same kind of data from the same API: values that change per Deadlock
patch, not per match, so they are fetched once and committed.

```js
// --- rank tiers -------------------------------------------------------------
// 12 tiers, subranks 1-6. Each tier carries its own colour, used to tint the
// RANK column. These are generated rather than transcribed because an earlier
// hand-written table had 11 of 12 colours wrong and nothing caught it.
const RANKS_URL = 'https://api.deadlock-api.com/v1/assets/ranks';

const rankRes = await fetch(RANKS_URL);
if (!rankRes.ok) throw new Error(`ranks fetch failed: ${rankRes.status}`);
const ranks = await rankRes.json();

const tiers = ranks
  .map(r => ({ tier: r.tier, name: r.name, color: (r.color ?? '').toUpperCase() }))
  .sort((a, b) => a.tier - b.tier);

if (tiers.length !== 12) throw new Error(`expected 12 tiers, got ${tiers.length}`);
for (const t of tiers) {
  if (!/^#[0-9A-F]{6}$/.test(t.color)) {
    throw new Error(`tier ${t.tier} (${t.name}) has no usable colour: ${t.color}`);
  }
}

const tierModule = `/* GENERATED by scripts/tokens.mjs — do not edit by hand.
   Source: ${RANKS_URL}
   Regenerate after a Deadlock patch: npm run tokens */
export const TIERS = [
${tiers.map(t => `  { tier: ${t.tier}, name: ${JSON.stringify(t.name)}, color: '${t.color}' }`).join(',
')}
];
`;

mkdirSync('proxy', { recursive: true });
writeFileSync('proxy/rank-tiers.js', tierModule);
console.log(`wrote proxy/rank-tiers.js — ${tiers.length} tiers`);
```

Run it: `npm run tokens`
Expected: the existing `wrote overlay/tokens.css — 184 colours` line, then
`wrote proxy/rank-tiers.js — 12 tiers`.

**Sanity-check the output before moving on.** Open `proxy/rank-tiers.js` and
confirm Eternus reads `#5CE9A9` and Ascendant `#C39751`. If Eternus comes back
gold, the generator is not reading the API's `color` field.

- [ ] **Step 3: Write `proxy/rank.js`**

```js
// The tier table is GENERATED from /v1/assets/ranks by scripts/tokens.mjs.
// Do not inline the values here: an earlier draft did, and 11 of the 12 colours
// were wrong. Archon / Alchemist / Arcanist are former tier names and must not
// reappear — see spec section 3.4.
import { TIERS } from './rank-tiers.js';
export { TIERS };

const FALLBACK_LABEL = 'UNRANKED';
const FALLBACK_COLOR = '#FFED79';

function tier(rank) {
  return Number.isInteger(rank) && rank >= 0 && rank < TIERS.length ? TIERS[rank] : null;
}

/** 'ASCENDANT 6'. Always <= 11 characters, never leaks undefined/NaN. */
export function rankLabel(rank, subrank) {
  const t = tier(rank);
  if (!t) return FALLBACK_LABEL;
  const s = Number.isInteger(subrank) && subrank >= 1 && subrank <= 6 ? ` ${subrank}` : '';
  return (t.name + s).toUpperCase();
}

export function tierColor(rank) {
  return tier(rank)?.color ?? FALLBACK_COLOR;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/rank.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Confirm the Review Focus case is covered**

The `out-of-range tier degrades safely` test above *is* Review Focus item 5. Confirm it passes and that `rankLabel(12, 3)` returns `'UNRANKED'` rather than `'UNDEFINED 3'`.

- [ ] **Step 6: Commit**

```bash
git add proxy/rank.js tests/rank.test.js
git commit -m "feat: rank tier formatting with safe fallback for unknown tiers"
```

---

### Task 4: Derive per-player stats

**Files:**
- Create: `proxy/derive.js`
- Test: `tests/derive.test.js`

**Interfaces:**
- Consumes: `fixtures/match-history.sample.json`.
- Produces:
  - `isCountable(entry) → boolean`
  - `isScored(entry) → boolean`
  - `isWin(entry) → boolean`
  - `isAbandon(entry) → boolean`
  - `form(entries, n = 11) → string` — newest-first, `'W'`/`'L'`, right-padded with spaces to `n`.
  - `seasonRecord(entries) → { wins, losses, text }`
  - `abandonCount(entries) → number`
  - `streak(entries) → { kind: 'W'|'L'|null, n }`
  - `averages(entries) → { kd, netWorth, lastHits, denies, matchLen }`
  - `derivePlayer(entries) → { form, season, abandons, streak, averages, matches }`

**Two API behaviours this task exists to encode correctly.** Both were measured against 4,348 real entries and both are counter-intuitive:

1. **`player_match_outcome` is not a reliable win/loss flag.** Two separate
   measurements, which disagree in an instructive way:
   - Over one player's **full** 4,348-entry history it is `0` (unset) on 3,951
     rows — 91%. Older matches predate the field being populated.
   - Over the **60 most recent** matches in `fixtures/match-history.sample.json`
     it is `0` on only 1 of 63 rows, and `outcome === 1` agrees with
     `player_team === match_result` on every row.

   So it is populated for recent matches and absent for old ones — which is
   precisely why it cannot be the derivation. A player's season record spans
   both eras. It also carries values beyond `0/1/2`: the fixture contains
   **3 and 5**, whose meanings are undocumented, so it is not a boolean even
   where present.

   Win/loss must therefore be derived as **`player_team === match_result`**,
   which needs no knowledge of the enum and works across both eras. Cross-tabs
   from both samples agree with it: where the two fields are equal the outcome
   is never `2`, and where they differ it is never `1`.
2. **Not every history entry belongs in a win/loss record.** Measured in the
   recorded fixture: `game_mode` is `1` (Normal) on 61 of 63 entries and `4`
   (**Street Brawl**) on 2; `match_mode` is `4` (Ranked) on 60 and `1`
   (Unranked) on 3. Street Brawl is a round-based mode with its own scoring —
   those two entries carry real `brawl_score_team0` values of 1 and 2 while the
   other 54 are zero defaults.

   Counting Street Brawl in a MOBA win/loss record is counting a different
   sport. It is not hypothetical: the displayed SEASON string differs by mode
   filter, `32-31` unfiltered against `32-29` filtered — so without a rule the
   overlay shows one of them by accident rather than by decision.

   `derive.js` therefore counts only **Normal-mode Unranked or Ranked** play, as
   an **allowlist**: `game_mode === 1 && (match_mode === 1 || match_mode === 4)`.
   An allowlist rather than a blocklist because the enum has seven match modes
   (`unranked, private_lobby, coop_bot, ranked, server_test, tutorial,
   hero_labs`) and only `1` and `4` are confirmed by observation. An unknown
   mode number is then excluded by default, which is the safe direction — a
   mystery mode cannot inflate a win rate, and `coop_bot` very much would.

3. **`abandoned_time_s` uses `0` as a sentinel, not `null`.** Across 4,348 entries: `null` 3,270 times, `0` 1,074 times, and non-zero only **4** times. Treating "non-null" as an abandon — which the spec's prose implies — would report 1,074 abandons instead of 4. The test below pins this.

**Abandons are counted over the full countable history, not a 20-match window.** At a 0.09% base rate a 20-match window expects 0.018 abandons per player, so a windowed column reads `0` for all 12 players almost always. An all-time integer is informative. This adjusts spec §5.4 and is the one place this plan departs from it.

- [ ] **Step 1: Write the failing test — win/loss derivation**

Create `tests/derive.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isCountable, isScored, isWin, isAbandon, form, seasonRecord,
  abandonCount, streak, averages, derivePlayer
} from '../proxy/derive.js';

const REAL = JSON.parse(readFileSync('fixtures/match-history.sample.json', 'utf8'));

// Minimal synthetic entry; override what a test cares about.
// game_mode 1 (Normal) + match_mode 4 (Ranked) make it countable by default —
// without them isCountable rejects the entry and every aggregate reads zero.
const e = (over = {}) => ({
  match_id: 1, start_time: 1000, player_team: 0, match_result: 0,
  game_mode: 1, match_mode: 4,
  player_kills: 5, player_deaths: 5, player_assists: 5,
  net_worth: 50000, last_hits: 150, denies: 10,
  match_duration_s: 1800, hero_id: 1, abandoned_time_s: null, ...over
});

test('a win is player_team === match_result', () => {
  assert.equal(isWin(e({ player_team: 0, match_result: 0 })), true);
  assert.equal(isWin(e({ player_team: 1, match_result: 1 })), true);
  assert.equal(isWin(e({ player_team: 0, match_result: 1 })), false);
  assert.equal(isWin(e({ player_team: 1, match_result: 0 })), false);
});

test('Street Brawl is excluded — it is a different mode with its own scoring', () => {
  const brawl = e({ game_mode: 4, match_mode: 1, brawl_score_team0: 2 });
  assert.equal(isCountable(brawl), false);
  assert.equal(isScored(brawl), false, 'must not reach the win/loss comparison');

  const mixed = [
    e({ match_id: 1, player_team: 0, match_result: 0 }),                 // normal W
    e({ match_id: 2, player_team: 0, match_result: 1 }),                 // normal L
    e({ match_id: 3, game_mode: 4, match_mode: 1, player_team: 0, match_result: 1 })
  ];
  const rec = seasonRecord(mixed);
  assert.deepEqual({ wins: rec.wins, losses: rec.losses }, { wins: 1, losses: 1 },
    'the brawl entry must not appear in the record');
});

test('unranked normal play DOES count', () => {
  assert.equal(isCountable(e({ match_mode: 1 })), true, 'match_mode 1 is Unranked');
  assert.equal(isCountable(e({ match_mode: 4 })), true, 'match_mode 4 is Ranked');
});

test('an unrecognised mode is excluded, not counted — allowlist not blocklist', () => {
  // The enum holds private_lobby, coop_bot, server_test, tutorial and hero_labs
  // whose numbers are unconfirmed. Excluding by default means a bot-game mode
  // cannot silently inflate a win rate.
  for (const mm of [0, 2, 3, 5, 6, 7, 99, null, undefined]) {
    assert.equal(isCountable(e({ match_mode: mm })), false,
      `match_mode ${mm} is unconfirmed and must not count`);
  }
  for (const gm of [0, 2, 3, 4, 99, null, undefined]) {
    assert.equal(isCountable(e({ game_mode: gm })), false,
      `game_mode ${gm} is not Normal and must not count`);
  }
});

test('averages exclude non-countable entries', () => {
  // A brawl round is short and has its own net-worth scale; one would skew
  // every average on the board.
  const rows = [
    e({ net_worth: 50000, match_duration_s: 1800 }),
    e({ game_mode: 4, match_mode: 1, net_worth: 5, match_duration_s: 60 })
  ];
  assert.equal(averages(rows).netWorth, 50000, 'the brawl entry must not drag the mean');
  assert.equal(averages(rows).matchLen, 1800);
});

test('player_match_outcome is never consulted, even when it contradicts', () => {
  // An entry whose outcome field disagrees with the team/result pair. The
  // derivation must ignore it: outcome is unset on 91% of a long history and
  // is not a boolean where it is set.
  const misleading = e({ player_team: 0, match_result: 0, player_match_outcome: 2 });
  assert.equal(isWin(misleading), true, 'must trust player_team === match_result');

  const alsoMisleading = e({ player_team: 0, match_result: 1, player_match_outcome: 1 });
  assert.equal(isWin(alsoMisleading), false, 'a 1 must not override a team/result mismatch');
});

test('the real fixture shows why outcome cannot be treated as a boolean', () => {
  const outcomes = new Set(REAL.map(r => r.player_match_outcome));
  // Observed in fixtures/match-history.sample.json: 0, 1, 2, 3 and 5. Anyone
  // tempted to "simplify" isWin to `outcome === 1` should see this fail to be
  // a two-valued field first.
  const beyondBoolean = [...outcomes].filter(v => v !== undefined && v > 2);
  assert.ok(beyondBoolean.length > 0,
    `expected outcome values above 2; got ${[...outcomes].join(',')}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/derive.test.js`
Expected: FAIL — cannot find module `../proxy/derive.js`.

- [ ] **Step 3: Write the win/loss and scoring predicates**

Create `proxy/derive.js`:

```js
/**
 * Derives per-player statistics from /v1/players/{id}/match-history.
 * Every function here is pure. See spec section 3.6.
 */

/**
 * Normal-mode competitive play only — an ALLOWLIST.
 *
 * game_mode 1 = Normal, 4 = Street Brawl (a round-based mode with its own
 * scoring; two such entries in the recorded fixture carry real brawl scores).
 * match_mode 1 = Unranked, 4 = Ranked; the enum also holds private_lobby,
 * coop_bot, server_test, tutorial and hero_labs, whose numbers are not
 * confirmed by observation.
 *
 * Allowlisting means an unrecognised mode is excluded rather than counted. That
 * is the safe direction: a mystery mode cannot inflate a win rate, and bot
 * games would.
 */
const NORMAL_GAME_MODE = 1;
const COMPETITIVE_MATCH_MODES = new Set([1, 4]);

export function isCountable(entry) {
  return entry?.game_mode === NORMAL_GAME_MODE
      && COMPETITIVE_MATCH_MODES.has(entry?.match_mode);
}

/** An entry only counts toward W/L if both sides of the comparison exist. */
export function isScored(entry) {
  return isCountable(entry)
      && Number.isInteger(entry?.player_team)
      && Number.isInteger(entry?.match_result);
}

/**
 * Win iff the player's team is the winning team.
 *
 * Do NOT substitute `player_match_outcome`. It looks tempting because on recent
 * matches `outcome === 1` tracks this exactly — but it is unset (0) on 91% of a
 * 4,348-entry history, because older matches predate the field, and a season
 * record spans both eras. It is also not boolean where it IS set: the recorded
 * fixture contains outcome values 3 and 5 alongside 0/1/2, with undocumented
 * meanings. Comparing team to result needs no enum knowledge and holds
 * everywhere. Cross-tabs over both a 4,348-entry and a 63-entry sample agree:
 * where the two are equal the outcome is never 2, where they differ never 1.
 */
export function isWin(entry) {
  return isScored(entry) && entry.player_team === entry.match_result;
}

/**
 * abandoned_time_s uses 0 as "did not abandon", NOT null. Live distribution
 * over 4,348 entries: null 3,270, zero 1,074, non-zero 4. Treating non-null
 * as an abandon would over-report by ~270x.
 */
export function isAbandon(entry) {
  return typeof entry?.abandoned_time_s === 'number' && entry.abandoned_time_s > 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/derive.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the failing test — unscored entries and the abandon sentinel**

This is **Review Focus item 3**. Append to `tests/derive.test.js`:

```js
test('unscored and in-progress entries are excluded from W/L', () => {
  assert.equal(isScored(e({ match_result: null })), false);
  assert.equal(isScored(e({ player_team: null })), false);
  assert.equal(isScored(e({ match_result: undefined })), false);
  assert.equal(isWin(e({ match_result: null })), false, 'must not count as a win');

  const mixed = [
    e({ match_id: 1, player_team: 0, match_result: 0 }),   // W
    e({ match_id: 2, player_team: 0, match_result: null }), // unscored
    e({ match_id: 3, player_team: 0, match_result: 1 })     // L
  ];
  const rec = seasonRecord(mixed);
  assert.deepEqual({ wins: rec.wins, losses: rec.losses }, { wins: 1, losses: 1 },
    'the unscored entry must be dropped, not counted as a loss');
});

test('abandon detection uses > 0, not non-null', () => {
  assert.equal(isAbandon(e({ abandoned_time_s: null })), false);
  assert.equal(isAbandon(e({ abandoned_time_s: 0 })), false, '0 means did not abandon');
  assert.equal(isAbandon(e({ abandoned_time_s: 483 })), true);

  const rows = [
    e({ abandoned_time_s: null }), e({ abandoned_time_s: 0 }),
    e({ abandoned_time_s: 0 }), e({ abandoned_time_s: 256 })
  ];
  assert.equal(abandonCount(rows), 1, 'three non-abandons, one abandon');
});

test('the real fixture reports a plausible abandon count', () => {
  const n = abandonCount(REAL);
  assert.ok(n >= 1, 'fixture retains at least one abandon');
  assert.ok(n < REAL.length * 0.1,
    `${n} of ${REAL.length} is implausibly high — the 0-sentinel bug is back`);
});
```

- [ ] **Step 6: Implement records, abandons and form**

Append to `proxy/derive.js`:

```js
const byNewest = (a, b) => (b.start_time ?? 0) - (a.start_time ?? 0);

/** Newest-first copy. The API's order is not contractual, so sort explicitly. */
function recent(entries) {
  return (entries ?? []).slice().sort(byNewest);
}

export function seasonRecord(entries) {
  let wins = 0, losses = 0;
  for (const en of entries ?? []) {
    if (!isScored(en)) continue;
    if (isWin(en)) wins++; else losses++;
  }
  return { wins, losses, text: `${wins}-${losses}` };
}

/** All-time count over countable play. See the base-rate note in the preamble. */
export function abandonCount(entries) {
  let n = 0;
  for (const en of entries ?? []) if (isCountable(en) && isAbandon(en)) n++;
  return n;
}

/**
 * The FORM column: the last n scored results, newest first, as 'W'/'L'.
 * Short histories are padded with spaces so the string is always exactly n
 * characters — the board's cell count is fixed and must not be fed a short
 * string.
 */
export function form(entries, n = 11) {
  const chars = recent(entries)
    .filter(isScored)
    .slice(0, n)
    .map(en => (isWin(en) ? 'W' : 'L'));
  return chars.join('').padEnd(n, ' ');
}
```

- [ ] **Step 7: Write the failing test — short histories**

This is **Review Focus item 2**. Append to `tests/derive.test.js`:

```js
test('form is always exactly n characters', () => {
  assert.equal(form(REAL, 11).length, 11);
  assert.equal(form([], 11).length, 11);
  assert.equal(form(null, 11).length, 11);
});

test('a brand-new account with 3 matches pads rather than breaking', () => {
  const three = [
    e({ match_id: 1, start_time: 300, player_team: 0, match_result: 0 }),
    e({ match_id: 2, start_time: 200, player_team: 0, match_result: 1 }),
    e({ match_id: 3, start_time: 100, player_team: 0, match_result: 0 })
  ];
  const f = form(three, 11);
  assert.equal(f.length, 11);
  assert.equal(f, 'WLW        ', 'results left, blanks right, no repeats');
  assert.equal(f.trim().length, 3, 'exactly three results, not eleven');
});

test('form is newest-first regardless of input order', () => {
  const shuffled = [
    e({ match_id: 1, start_time: 100, player_team: 0, match_result: 1 }), // oldest, L
    e({ match_id: 2, start_time: 300, player_team: 0, match_result: 0 }), // newest, W
    e({ match_id: 3, start_time: 200, player_team: 0, match_result: 1 })  // middle, L
  ];
  assert.equal(form(shuffled, 3), 'WLL');
});

test('an all-unscored history yields a blank form, not an exception', () => {
  const none = [e({ match_result: null }), e({ match_result: null })];
  assert.equal(form(none, 11), '           ');
  assert.equal(form(none, 11).length, 11);
});
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test tests/derive.test.js`
Expected: PASS. If `a brand-new account` fails on ordering, check that `form` sorts before slicing.

- [ ] **Step 9: Implement streak, averages and the composite**

Append to `proxy/derive.js`:

```js
/** Current run of identical results, newest-first. */
export function streak(entries) {
  const scored = recent(entries).filter(isScored);
  if (!scored.length) return { kind: null, n: 0 };
  const kind = isWin(scored[0]) ? 'W' : 'L';
  let n = 0;
  for (const en of scored) {
    if ((isWin(en) ? 'W' : 'L') !== kind) break;
    n++;
  }
  return { kind, n };
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
// Countable-only: a Street Brawl round lasts minutes and has its own net-worth
// scale, so including one would skew every average on the board.
const nums = (entries, field) =>
  (entries ?? []).filter(isCountable).map(en => en?.[field]).filter(v => typeof v === 'number');

export function averages(entries) {
  const kills = nums(entries, 'player_kills');
  const deaths = nums(entries, 'player_deaths');
  const totalDeaths = deaths.reduce((a, b) => a + b, 0);
  return {
    // guard the zero-death case: a player who has never died is 'inf', not NaN
    kd: totalDeaths === 0
      ? (kills.length ? Infinity : 0)
      : kills.reduce((a, b) => a + b, 0) / totalDeaths,
    netWorth: mean(nums(entries, 'net_worth')),
    lastHits: mean(nums(entries, 'last_hits')),
    denies: mean(nums(entries, 'denies')),
    matchLen: mean(nums(entries, 'match_duration_s'))
  };
}

/** Everything the board and the free stat tier need, from one history array. */
export function derivePlayer(entries) {
  const scored = (entries ?? []).filter(isScored);
  return {
    form: form(entries, 11),
    season: seasonRecord(entries),
    abandons: abandonCount(entries),
    streak: streak(entries),
    averages: averages(entries),
    matches: scored.length
  };
}
```

- [ ] **Step 10: Write the remaining tests**

Append to `tests/derive.test.js`:

```js
test('streak counts the current run only', () => {
  const rows = [
    e({ match_id: 1, start_time: 500, player_team: 0, match_result: 0 }),
    e({ match_id: 2, start_time: 400, player_team: 0, match_result: 0 }),
    e({ match_id: 3, start_time: 300, player_team: 0, match_result: 1 }),
    e({ match_id: 4, start_time: 200, player_team: 0, match_result: 0 })
  ];
  assert.deepEqual(streak(rows), { kind: 'W', n: 2 });
  assert.deepEqual(streak([]), { kind: null, n: 0 });
});

test('a player who has never died gives Infinity, not NaN', () => {
  const flawless = [e({ player_kills: 7, player_deaths: 0 })];
  assert.equal(averages(flawless).kd, Infinity);
  assert.ok(!Number.isNaN(averages([]).kd));
});

test('derivePlayer on the real fixture is internally consistent', () => {
  const d = derivePlayer(REAL);
  assert.equal(d.form.length, 11);
  assert.equal(d.season.wins + d.season.losses, d.matches);
  assert.ok(d.season.text.includes('-'));
  assert.ok(d.season.text.length <= 11, 'season must fit the cell budget');
  assert.ok(d.abandons >= 0);
  assert.ok(d.averages.netWorth > 0);
});
```

- [ ] **Step 11: Run the full suite**

Run: `npm test`
Expected: PASS, all files.

- [ ] **Step 12: Commit**

```bash
git add proxy/derive.js tests/derive.test.js
git commit -m "feat: derive per-player stats, encoding the outcome and abandon sentinels"
```

---

### Task 5: API client and cache

**Files:**
- Create: `proxy/config.js`
- Create: `proxy/deadlock.js`
- Create: `proxy/cache.js`
- Test: `tests/cache.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `config.js`: `ACCOUNT_ID`, `TEAM0_IS_AMBER`, `FACTIONS`, `POLL_MS`, `MATCH_TTL_MS`, `CONTEXT_TTL_MS`, `HISTORY_CONCURRENCY`.
  - `deadlock.js`: `activeMatchFor(accountId)`, `batchSteam(ids)`, `batchRank(ids)`, `matchHistory(id)`, `resolveCommands(vars)` — each returning parsed JSON or throwing.
  - `cache.js`: `makeCache(ttlMs, clock = () => Date.now())` → `{ get(key), set(key, value), stale(key) }`. The `clock` parameter exists so tests can advance time without sleeping.

- [ ] **Step 1: Write `proxy/config.js`**

```js
/** Operator identity and tunables. This is the only file a second user edits. */

// SteamID3. Find yours at https://steamid.io — the "steamID3" value's numeric part.
export const ACCOUNT_ID = Number(process.env.DSN_ACCOUNT_ID ?? 0);

/**
 * PENDING DAY-ONE VERIFICATION — spec section 4.2.
 *
 * Valve's CSS names its tokens team1_color / team2_color (1-indexed) while the
 * API returns Team0 / Team1 and net_worth_team_0 (0-indexed). Convention makes
 * team1_color the first team, i.e. Team0 = amber. That is convention, not
 * documentation. Confirm against one real match, then delete this comment.
 */
export const TEAM0_IS_AMBER = true;

/** Faction names are bound to COLOUR, not to team index, so a wrong index
 *  mapping is a one-line fix rather than a mislabelled broadcast. */
export const FACTIONS = { amber: 'Hidden King', sapphire: 'Archmother' };

export const POLL_MS = 15_000;          // match detection
export const MATCH_TTL_MS = 6 * 60_000; // roster is immutable after start
export const CONTEXT_TTL_MS = 60 * 60_000;
export const HISTORY_CONCURRENCY = 3;   // 12 x 2.5MB; do not fetch in parallel
```

- [ ] **Step 2: Write the failing test for the cache**

Create `tests/cache.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCache } from '../proxy/cache.js';

test('returns a stored value within its TTL', () => {
  const c = makeCache(1000);
  c.set('k', { a: 1 });
  assert.deepEqual(c.get('k'), { a: 1 });
  assert.equal(c.stale('k'), false);
});

test('reports stale past the TTL but still returns the value', () => {
  let now = 0;
  const c = makeCache(1000, () => now);
  c.set('k', 'v');
  now = 1500;
  assert.equal(c.stale('k'), true);
  assert.equal(c.get('k'), 'v',
    'a stale value is still served — never render a hole, spec section 9');
});

test('an unknown key is undefined and stale', () => {
  const c = makeCache(1000);
  assert.equal(c.get('nope'), undefined);
  assert.equal(c.stale('nope'), true);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/cache.test.js`
Expected: FAIL — cannot find module `../proxy/cache.js`.

- [ ] **Step 4: Write `proxy/cache.js`**

Note that `get` deliberately ignores expiry. Staleness is advisory: the server prefers fresh data but serves stale rather than nothing, per spec §9.

```js
/** A TTL store whose expiry is advisory: stale values are still returned. */
export function makeCache(ttlMs, clock = () => Date.now()) {
  const store = new Map();
  return {
    get(key) { return store.get(key)?.value; },
    set(key, value) { store.set(key, { value, at: clock() }); },
    stale(key) {
      const hit = store.get(key);
      return !hit || clock() - hit.at > ttlMs;
    }
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/cache.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write `proxy/deadlock.js`**

The only file that talks to the Deadlock API. Rate limits are documented inline at each call site because they are the binding constraint on the whole design.

```js
import { HISTORY_CONCURRENCY } from './config.js';

const API = 'https://api.deadlock-api.com/v1';

async function get(path) {
  const res = await fetch(API + path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`deadlock-api ${path} -> ${res.status}`);
  return res.json();
}

/** Watch-tab index, ~150 concurrent matches, sorted by average MMR.
 *  100 req/s. Returns the match object or null if this player isn't in it. */
export async function activeMatchFor(accountId) {
  const rows = await get(`/matches/active?account_id=${accountId}`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** 100 req/s on the read path. -> [{account_id, personaname, avatar, ...}] */
export function batchSteam(ids) {
  return get(`/players/steam?account_ids=${ids.join(',')}`);
}

/** 20 req/min per IP — the project's rate ceiling. Once per match, never poll.
 *  -> [{account_id, badge, rank, subrank, last_match}] */
export function batchRank(ids) {
  return get(`/players/rank?account_ids=${ids.join(',')}`);
}

/** 100 req/s, but ~2.5MB per player. Caller must reduce and discard the raw. */
export function matchHistory(accountId) {
  return get(`/players/${accountId}/match-history`);
}

/** 60 req/60s. vars is an array of names from /v1/commands/variables/available. */
export function resolveCommands(accountId, vars) {
  const q = new URLSearchParams({ account_id: String(accountId), query: vars.join(',') });
  return get(`/commands/resolve?${q}`);
}

/**
 * Map ids through fn with bounded concurrency. Twelve 2.5MB downloads in
 * parallel is ~30MB in flight and will stall a streaming PC's uplink; three
 * at a time keeps it civil.
 */
export async function mapLimited(ids, fn, limit = HISTORY_CONCURRENCY) {
  const out = new Map();
  const queue = ids.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      try { out.set(id, await fn(id)); } catch { out.set(id, null); }
    }
  });
  await Promise.all(workers);
  return out;
}
```

- [ ] **Step 7: Commit**

```bash
git add proxy/config.js proxy/deadlock.js proxy/cache.js tests/cache.test.js
git commit -m "feat: API client with bounded concurrency, config and advisory TTL cache"
```

---

### Task 6: State assembly and the server

**Files:**
- Create: `proxy/state.js`
- Create: `proxy/server.js`
- Test: `tests/state.test.js`

**Interfaces:**
- Consumes: `derivePlayer` (Task 4), `rankLabel`/`tierColor` (Task 3), `FACTIONS`/`TEAM0_IS_AMBER` (Task 5).
- Produces:
  - `buildState({ match, steam, ranks, derived, session, now }) → StateDoc`
  - `emptyState(reason) → StateDoc` with `phase: 'IDLE'`
  - `derived` is a `Map<accountId, DerivedStats>` — the output of
    `derivePlayer`, **not** raw history arrays. The caller derives and discards
    each 2.5 MB payload as it goes, so peak memory is one history rather than
    twelve (~30 MB). `playerRow` therefore consumes pre-derived stats and never
    calls `derivePlayer` itself.
  - `StateDoc` shape, which the entire overlay renders from:

```js
{
  phase: 'IDLE' | 'QUEUE' | 'MATCH' | 'RECAP',
  matchId: number | null,
  factions: { amber: 'Hidden King', sapphire: 'Archmother' },
  teams: [
    { faction: 'Hidden King', colorVar: '--team-amber',
      players: [ {
        accountId, name, avatar, heroId, isSelf,
        form,            // 11 chars
        season,          // '147-117'
        abandons,        // '4'
        rank,            // 'ASCENDANT 6'
        rankColor,       // '#C39751'
        kd, streak, netWorth, lastHits, denies, matches
      } ] },
    { faction: 'Archmother', colorVar: '--team-sapphire', players: [ ... ] }
  ],
  session: { todayRecord, kd, rank, rankProgress },
  generatedAt: number
}
```

- [ ] **Step 1: Write the failing test**

Create `tests/state.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildState, emptyState } from '../proxy/state.js';
import { derivePlayer } from '../proxy/derive.js';

const load = f => JSON.parse(readFileSync(`fixtures/${f}`, 'utf8'));
const match = load('active.sample.json');
const steam = load('steam.sample.json');
const ranks = load('rank.sample.json');
const history = load('match-history.sample.json');

/**
 * buildState takes PRE-DERIVED stats, not raw histories — the caller reduces
 * each 2.5MB payload and releases it. Every roster member gets the same
 * derived block here, which is enough to exercise the document's shape.
 */
const stats = derivePlayer(history);
const fullDerived = new Map(match.players.map(p => [p.account_id, stats]));

test('builds two teams of six from a 12-player roster', () => {
  const s = buildState({ match, steam, ranks, derived: fullDerived, session: {}, now: 1 });
  assert.equal(s.phase, 'MATCH');
  assert.equal(s.teams.length, 2);
  assert.equal(s.teams[0].players.length, 6);
  assert.equal(s.teams[1].players.length, 6);
  assert.equal(s.teams[0].faction, 'Hidden King');
  assert.equal(s.teams[1].faction, 'Archmother');
});

test('every player row carries board-ready strings within the cell budget', () => {
  const s = buildState({ match, steam, ranks, derived: fullDerived, session: {}, now: 1 });
  for (const team of s.teams) {
    for (const p of team.players) {
      assert.equal(p.form.length, 11, 'FORM must fill all 11 cells');
      assert.ok(p.season.length <= 11, `season "${p.season}" too long`);
      assert.ok(p.rank.length <= 11, `rank "${p.rank}" too long`);
      assert.ok(String(p.abandons).length <= 11);
      assert.doesNotMatch(p.rank, /undefined|NaN/);
      assert.equal(typeof p.name, 'string');
      assert.ok(p.name.length > 0, 'a name must never be empty');
    }
  }
});

test('emptyState is renderable and never throws', () => {
  const s = emptyState('no match');
  assert.equal(s.phase, 'IDLE');
  assert.equal(s.teams.length, 2);
  assert.deepEqual(s.teams[0].players, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/state.test.js`
Expected: FAIL — cannot find module `../proxy/state.js`.

- [ ] **Step 3: Write `proxy/state.js`**

```js
import { rankLabel, tierColor } from './rank.js';
import { FACTIONS, TEAM0_IS_AMBER, ACCOUNT_ID } from './config.js';

const PLACEHOLDER_NAME = 'UNKNOWN';

/** Shape-compatible zero value, so a player with no history still renders. */
const EMPTY_DERIVED = {
  form: ' '.repeat(11),
  season: { wins: 0, losses: 0, text: '0-0' },
  abandons: 0,
  streak: { kind: null, n: 0 },
  averages: { kd: 0, netWorth: 0, lastHits: 0, denies: 0, matchLen: 0 },
  matches: 0
};

function indexBy(rows, key) {
  const m = new Map();
  for (const r of rows ?? []) if (r && key in r) m.set(r[key], r);
  return m;
}

const k = n => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const secs = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function playerRow(p, steamById, rankById, derived) {
  const prof = steamById.get(p.account_id);
  const rk = rankById.get(p.account_id);
  // Pre-derived by the caller so each 2.5MB history is released before the
  // next is fetched. EMPTY_DERIVED keeps a missing entry renderable.
  const d = derived.get(p.account_id) ?? EMPTY_DERIVED;
  const kd = d.averages.kd;
  return {
    accountId: p.account_id,
    // A private profile or an omitted batch row must not blank the board.
    name: prof?.personaname?.trim() || PLACEHOLDER_NAME,
    avatar: prof?.avatarmedium ?? prof?.avatar ?? null,
    heroId: p.hero_id ?? null,
    isSelf: p.account_id === ACCOUNT_ID,
    form: d.form,
    season: d.season.text,
    abandons: String(d.abandons),
    rank: rk ? rankLabel(rk.rank, rk.subrank) : 'UNRANKED',
    rankColor: rk ? tierColor(rk.rank) : tierColor(-1),
    kd: Number.isFinite(kd) ? kd.toFixed(1) : '∞',
    streak: d.streak.kind ? `${d.streak.kind}${d.streak.n}` : '0',
    netWorth: k(d.averages.netWorth),
    lastHits: String(Math.round(d.averages.lastHits)),
    denies: String(Math.round(d.averages.denies)),
    matches: String(d.matches)
  };
}

export function emptyState(reason = '') {
  return {
    phase: 'IDLE', matchId: null, reason,
    factions: FACTIONS,
    teams: [
      { faction: FACTIONS.amber, colorVar: '--team-amber', players: [] },
      { faction: FACTIONS.sapphire, colorVar: '--team-sapphire', players: [] }
    ],
    session: {}, generatedAt: Date.now()
  };
}

export function buildState({ match, steam, ranks, derived, session = {}, now = Date.now() }) {
  if (!match?.players?.length) return { ...emptyState('no active match'), generatedAt: now };

  const steamById = indexBy(steam, 'account_id');
  const rankById = indexBy(ranks, 'account_id');

  const amberIdx = TEAM0_IS_AMBER ? 0 : 1;
  const bucket = { amber: [], sapphire: [] };
  for (const p of match.players) {
    const side = p.team === amberIdx ? 'amber' : 'sapphire';
    bucket[side].push(playerRow(p, steamById, rankById, derived ?? new Map()));
  }
  // The operator is pinned first within their own faction — spec section 5.1.
  for (const side of ['amber', 'sapphire']) {
    bucket[side].sort((a, b) => Number(b.isSelf) - Number(a.isSelf));
  }

  return {
    phase: 'MATCH',
    matchId: match.match_id ?? null,
    factions: FACTIONS,
    teams: [
      { faction: FACTIONS.amber, colorVar: '--team-amber', players: bucket.amber },
      { faction: FACTIONS.sapphire, colorVar: '--team-sapphire', players: bucket.sapphire }
    ],
    session, generatedAt: now
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/state.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing test — a player missing from the batch responses**

This is **Review Focus item 4**. Append to `tests/state.test.js`:

```js
test('a player absent from steam and rank keeps the board at 12 rows', () => {
  const victim = match.players[3].account_id;
  const s = buildState({
    match,
    steam: steam.filter(r => r.account_id !== victim),
    ranks: ranks.filter(r => r.account_id !== victim),
    derived: fullDerived, session: {}, now: 1
  });

  const all = s.teams.flatMap(t => t.players);
  assert.equal(all.length, 12, 'the row must survive, not be dropped');
  assert.equal(s.teams[0].players.length, 6, 'factions must not shift');
  assert.equal(s.teams[1].players.length, 6);

  const row = all.find(p => p.accountId === victim);
  assert.equal(row.name, 'UNKNOWN');
  assert.equal(row.rank, 'UNRANKED');
  assert.match(row.rankColor, /^#[0-9A-F]{6}$/i, 'a colour is still required');
  assert.equal(row.form.length, 11, 'FORM still fills the board');
});

test('a player with no history at all still renders', () => {
  const thin = new Map(match.players.map(p => [p.account_id, derivePlayer([])]));
  const s = buildState({ match, steam, ranks, derived: thin, session: {}, now: 1 });
  for (const p of s.teams.flatMap(t => t.players)) {
    assert.equal(p.form.length, 11);
    assert.equal(p.season, '0-0');
    assert.equal(p.abandons, '0');
    assert.ok(!/NaN/.test(JSON.stringify(p)), `NaN leaked into ${p.accountId}`);
  }
});

test('the operator is pinned first in their own faction', async () => {
  // ACCOUNT_ID is read from the environment when config.js is first loaded,
  // so it must be set BEFORE the dynamic import — and this test needs its own
  // module instance, which is why it imports rather than using the top-level
  // buildState. Without this the assertion is vacuous: nobody is ever isSelf.
  const target = match.players[4].account_id;
  process.env.DSN_ACCOUNT_ID = String(target);
  const fresh = await import(`../proxy/state.js?selftest=${target}`);

  const s = fresh.buildState({ match, steam, ranks, derived: fullDerived, session: {}, now: 1 });
  const all = s.teams.flatMap(t => t.players);

  const selves = all.filter(p => p.isSelf);
  assert.equal(selves.length, 1, 'exactly one row must be flagged as the operator');
  assert.equal(selves[0].accountId, target);

  const owning = s.teams.find(t => t.players.some(p => p.isSelf));
  assert.equal(owning.players[0].isSelf, true,
    'the operator must be row 0 of their own faction, not merely present');
  assert.equal(owning.players.length, 6, 'pinning must not change the faction size');

  delete process.env.DSN_ACCOUNT_ID;
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/state.test.js`
Expected: PASS, 6 tests. If `no history at all` fails on `NaN`, check the zero-length guards in `averages`.

- [ ] **Step 7: Write `proxy/server.js`**

One route for the overlay, one for development. `/fixture` is what makes the entire visual layer buildable with no game running.

```js
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { buildState, emptyState } from './state.js';
import { derivePlayer } from './derive.js';
import { makeCache } from './cache.js';
import {
  activeMatchFor, batchSteam, batchRank, matchHistory, mapLimited
} from './deadlock.js';
import { ACCOUNT_ID, POLL_MS, MATCH_TTL_MS } from './config.js';

const PORT = Number(process.env.PORT ?? 7331);
const matchCache = makeCache(MATCH_TTL_MS);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.otf': 'font/otf'
};

let current = emptyState('starting');

/** Fetch and reduce. Raw histories are discarded immediately — 12 x 2.5MB
 *  must never all be held at once. */
async function refresh() {
  try {
    const match = await activeMatchFor(ACCOUNT_ID);
    if (!match) { current = emptyState('no active match'); return; }

    const key = String(match.match_id);
    if (!matchCache.stale(key)) { current = matchCache.get(key); return; }

    const ids = match.players.map(p => p.account_id);
    const [steam, ranks] = await Promise.all([batchSteam(ids), batchRank(ids)]);

    // Derive inside the worker so each ~2.5MB payload is reduced to a small
    // object and released before the next is fetched. Peak memory is one
    // history, not twelve.
    const derived = new Map();
    await mapLimited(ids, async id => {
      const raw = await matchHistory(id);
      derived.set(id, derivePlayer(raw));
      return true;
    });

    const state = buildState({ match, steam, ranks, derived });
    matchCache.set(key, state);
    current = state;
  } catch (err) {
    // Never render a hole: keep serving the last good document.
    console.error('[refresh]', err.message);
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/state') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    });
    return res.end(JSON.stringify(current));
  }

  if (url.pathname === '/fixture') {
    const match = JSON.parse(readFileSync('fixtures/active.sample.json', 'utf8'));
    const history = JSON.parse(readFileSync('fixtures/match-history.sample.json', 'utf8'));
    const stats = derivePlayer(history);
    const state = buildState({
      match,
      steam: JSON.parse(readFileSync('fixtures/steam.sample.json', 'utf8')),
      ranks: JSON.parse(readFileSync('fixtures/rank.sample.json', 'utf8')),
      derived: new Map(match.players.map(p => [p.account_id, stats]))
    });
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(state));
  }

  // Static overlay files.
  //
  // This is safe against path traversal, but for non-obvious reasons worth
  // naming so a later "simplification" does not remove the protection. Two
  // independent layers:
  //   1. WHATWG URL collapses `..` segments in `pathname` before we see it, and
  //      decodes %2e — so `/%2e%2e/%2e%2e/x` arrives as `/x`.
  //   2. `path.normalize` CLAMPS `..` at root for a `/`-prefixed path:
  //      normalize('/../../../x') === '\\x', never '../../x'.
  // The `.replace` then covers the no-leading-slash case. Verified against 13
  // attack vectors (encoded, double-encoded, `....//`, null byte, backslash);
  // see the traversal test in tests/server.test.js.
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = join('overlay', normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (existsSync(file)) {
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    return res.end(readFileSync(file));
  }
  res.writeHead(404).end('not found');
});

server.listen(PORT, () => {
  console.log(`DSN proxy on http://localhost:${PORT}`);
  console.log(`  overlay   http://localhost:${PORT}/`);
  console.log(`  state     http://localhost:${PORT}/state`);
  console.log(`  fixture   http://localhost:${PORT}/fixture   (no game needed)`);
  if (!ACCOUNT_ID) console.warn('  DSN_ACCOUNT_ID is unset — /state will stay IDLE');
});

refresh();
setInterval(refresh, POLL_MS);
```

- [ ] **Step 8: Verify the fixture route by hand**

Run: `npm run serve` in one terminal, then in another:

```bash
curl -s http://localhost:7331/fixture | node -e "
  const s = JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log('phase', s.phase, '| teams', s.teams.map(t => t.faction + ':' + t.players.length).join(' '));
  console.log('row0', JSON.stringify(s.teams[0].players[0], null, 1));
"
```

Expected: `phase MATCH | teams Hidden King:6 Archmother:6`, and a row whose `form` is exactly 11 characters.

- [ ] **Step 9: Write the path-traversal regression test**

The static-file route resolves a request path against `overlay/`. It is safe,
but by a mechanism subtle enough that a refactor could silently remove the
protection — so pin it with a test rather than a comment. This tests the
resolution logic directly, with no server needed.

Create `tests/server.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, normalize, resolve, sep } from 'node:path';

/** The exact resolution the server performs, lifted for testability. */
function resolveStatic(rawUrl) {
  const url = new URL(rawUrl, 'http://localhost:7331');
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  return join('overlay', normalize(rel).replace(/^(\.\.[/\\])+/, ''));
}

const ROOT = resolve('overlay');

test('every traversal attempt stays inside overlay/', () => {
  const attacks = [
    '/../package.json',
    '/../../../../../../Windows/win.ini',
    '/%2e%2e%2fpackage.json',
    '/%2e%2e/%2e%2e/package.json',
    '/..%2f..%2fpackage.json',
    '/%252e%252e%252fpackage.json',
    '/....//....//package.json',
    '/../.git/config',
    '/%00/../package.json',
    '/a/b/../../../package.json',
    '//package.json',
    '/\\..\\..\\package.json'
  ];
  for (const attack of attacks) {
    const abs = resolve(resolveStatic(attack));
    assert.ok(abs.startsWith(ROOT),
      `${attack} escaped the overlay root -> ${abs}`);
  }
});

test('legitimate asset paths still resolve', () => {
  assert.match(resolveStatic('/'), /index\.html$/);
  assert.match(resolveStatic('/index.html'), /index\.html$/);
  assert.match(resolveStatic('/fonts/radiance-bold.otf'), /fonts[/\\]radiance-bold\.otf$/);
  assert.match(resolveStatic('/logo/eye.svg'), /logo[/\\]eye\.svg$/);
});

test('normalize clamps .. at root — the property the guard leans on', () => {
  // The guard is only sufficient because normalize refuses to walk above root
  // on a /-prefixed path. If a future Node changes that, this fails first and
  // tells you the guard needs strengthening.
  assert.equal(normalize('/../x'), sep + 'x');
  assert.equal(normalize('/../../../x'), sep + 'x');
  assert.equal(normalize('/a/../../x'), sep + 'x');
});
```

- [ ] **Step 10: Run the test**

Run: `node --test tests/server.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 11: Commit**

```bash
git add proxy/state.js proxy/server.js tests/state.test.js tests/server.test.js
git commit -m "feat: assemble the /state document and serve it, with a fixture route"
```

---

### Task 7: Overlay shell, layout and logo

**Files:**
- Create: `overlay/index.html`
- Create: `overlay/overlay.css`
- Create: `overlay/logo.js`

**Interfaces:**
- Consumes: `overlay/tokens.css`, `overlay/fonts/*`, `overlay/logo/*` (Task 1).
- Produces: DOM landmarks every later task attaches to — `#gameplay`, `#rail`, `#facecam`, `#board`, `#board-head`, `#stat-name`, `#chiron`, `#logo-bay`, `#spine`, `#groups`, `#persistent`, `#veil`, `#ident`, `#stage`.
  `logo.js` exports:
  - `mountLogo(host) → Promise<HTMLElement>` — replaces `host`'s children with the composited mark and **returns that `.mark` element**. Callers keep the return value; Task 11 needs it to drive the sweep.
  - `sweepLogo(mark) → void` — takes the element `mountLogo` returned.

- [ ] **Step 1: Write `overlay/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DSN Overlay</title>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="overlay.css">
</head>
<body>
<div id="stage">
  <div id="upper">
    <div id="gameplay"></div>
    <aside id="rail">
      <div id="facecam"></div>
      <header id="board-head">
        <div class="eyebrow">Match info</div>
        <div id="stat-name" class="flaprow"></div>
      </header>
      <div id="board"></div>
    </aside>
  </div>
  <footer id="chiron">
    <div id="logo-bay"></div>
    <div id="chiron-body">
      <div id="spine"></div>
      <div id="groups"></div>
      <div id="persistent"></div>
    </div>
  </footer>
  <div id="veil"></div>
  <div id="ident"></div>
</div>
<script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `overlay/overlay.css`**

Dimensions come straight from spec §4.1. `#gameplay` is transparent — OBS shows game capture through it; the overlay only draws chrome.

```css
@font-face { font-family: "Radiance"; font-weight: 600;
  src: url("fonts/radiance-semibold.otf") format("opentype"); font-display: block; }
@font-face { font-family: "Radiance"; font-weight: 700;
  src: url("fonts/radiance-bold.otf") format("opentype"); font-display: block; }
@font-face { font-family: "RadianceM";
  src: url("fonts/radiancem-semibold.otf") format("opentype"); font-display: block; }
@font-face { font-family: "Reaver"; font-weight: 700;
  src: url("fonts/reaver-bold.otf") format("opentype"); font-display: block; }

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1920px; height: 1080px; overflow: hidden; background: transparent; }
body { font-family: "Radiance", system-ui, sans-serif; color: var(--base-text); }

#stage { position: relative; width: 1920px; height: 1080px; display: flex; flex-direction: column; }
#upper { flex: 1; display: flex; min-height: 0; }

/* transparent: the game shows through here */
#gameplay { flex: 1; }

#rail {
  width: var(--rail-width); flex: none; display: flex; flex-direction: column;
  background: linear-gradient(180deg, #211E18, #14130F);
  border-left: 2px solid #3A3429;
}
#facecam {
  width: 100%; aspect-ratio: 16 / 9; flex: none;
  border-bottom: 2px solid var(--team-amber);
  background: #0E0B06;            /* OBS places the camera source over this */
}
#board-head {
  flex: none; padding: 8px 10px 7px;
  background: linear-gradient(180deg, #3A2D14, #241A08);
  border-bottom: 2px solid var(--team-amber);
}
#board-head .eyebrow {
  font-size: 8px; letter-spacing: .22em; text-transform: uppercase;
  color: #A3814A; font-weight: 800; margin-bottom: 6px; text-align: right;
}
/* the stat name is the column header for right-justified values, so it
   shares their right edge — spec section 5.1 */
.flaprow { display: flex; gap: 2px; justify-content: flex-end; }
#board { flex: 1; min-height: 0; }

#chiron {
  height: var(--chiron-height); flex: none; display: flex;
  background: linear-gradient(180deg, #2E2C27, #1A1916);
  border-top: 3px solid var(--team-amber);
}
#logo-bay {
  width: var(--logo-bay-width); flex: none; position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  border-right: 2px solid var(--team-amber);
  background:
    radial-gradient(130% 150% at 12% -10%, rgba(255,239,215,.17) 0%, rgba(255,239,215,.05) 34%, transparent 62%),
    linear-gradient(142deg, #1C1710 0%, #100C06 54%, #090703 100%);
}
#logo-bay::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(120% 130% at 50% 50%, transparent 42%, rgba(0,0,0,.55) 100%);
}
#chiron-body { flex: 1; display: flex; min-width: 0; }

/* transition surfaces, inert until machine.js drives them */
#veil, #ident {
  position: absolute; inset: 0; pointer-events: none; opacity: 0;
}
#veil { background: #070502; z-index: 10; }
#ident { z-index: 11; display: flex; align-items: center; justify-content: center; }

/* --- logo --- */
.mark { position: relative; width: 106px; aspect-ratio: 1; color: var(--mark-color); z-index: 2; }
.mark .layer { position: absolute; inset: 0; }
.mark .layer svg { width: 100%; height: 100%; display: block; }
.mark .layer path { fill: currentColor; }
.mark .outer, .mark .eye { transform-origin: 50% 50%; }
.mark .outer { animation: mark-spin var(--mark-rev) linear infinite; }
.mark .eye { animation: mark-blink var(--mark-blink) ease-in-out infinite; }
@keyframes mark-spin { to { transform: rotate(360deg); } }
@keyframes mark-blink {
  0%, 94%, 100% { transform: scaleY(1); }
  96.5% { transform: scaleY(.06); }
}
/* one deliberate half-turn, for a state change */
.mark.sweep .outer { animation: mark-sweep var(--xition-sweep) cubic-bezier(.3,.02,.2,1); }
@keyframes mark-sweep { from { transform: rotate(0); } to { transform: rotate(180deg); } }
```

- [ ] **Step 3: Write `overlay/logo.js`**

```js
// Valve's logo ships as three separate SVGs so the eye can animate on its own.
// Paths are fill="white" with no groups or clip paths, so swapping the fill to
// currentColor is the whole recolouring story.
const LAYERS = ['outer', 'inner_noeye', 'eye'];

const toCurrentColor = svg => svg
  .replace(/\swidth="[^"]*"/i, '')
  .replace(/\sheight="[^"]*"/i, '')
  .replace(/fill="white"/gi, 'fill="currentColor"');

export async function mountLogo(host) {
  const svgs = await Promise.all(
    LAYERS.map(n => fetch(`logo/${n}.svg`).then(r => r.text()))
  );
  const mark = document.createElement('div');
  mark.className = 'mark';
  LAYERS.forEach((name, i) => {
    const layer = document.createElement('div');
    // class names 'outer' and 'eye' are what overlay.css animates
    layer.className = `layer ${name === 'inner_noeye' ? 'inner' : name}`;
    layer.innerHTML = toCurrentColor(svgs[i]);
    mark.appendChild(layer);
  });
  host.replaceChildren(mark);
  return mark;
}

/** One 180 degree turn to mark a state boundary. Occludes nothing. */
export function sweepLogo(mark) {
  if (!mark) return;
  mark.classList.remove('sweep');
  void mark.offsetWidth;            // force reflow so the animation restarts
  mark.classList.add('sweep');
  setTimeout(() => mark.classList.remove('sweep'), 1250);
}
```

- [ ] **Step 4: Create a temporary `overlay/app.js` to see something**

```js
import { mountLogo } from './logo.js';
mountLogo(document.getElementById('logo-bay'));
```

- [ ] **Step 5: Verify in a browser**

Run `npm run serve`, open `http://localhost:7331/`. Expected: a dark rail on the right, a chiron across the bottom, and the bone Deadlock logo in the bay — rotating slowly and blinking roughly every 10s. The large left region is transparent, which in a browser looks white and in OBS shows the game.

Confirm the rotation is barely perceptible. At 90s it is 4°/s by design; if it looks like it is spinning, check that `--mark-rev` is `90s` and not inherited from somewhere else.

- [ ] **Step 6: Commit**

```bash
git add overlay/index.html overlay/overlay.css overlay/logo.js overlay/app.js
git commit -m "feat: overlay shell, layout regions and the layered logo"
```

---

### Task 8: Split-flap board

**Files:**
- Create: `overlay/flap.js`
- Create: `overlay/fit.js`
- Create: `overlay/board.js`
- Modify: `overlay/overlay.css` (append board and flap styles)
- Test: `tests/flap.test.js`, `tests/fit.test.js`

**Interfaces:**
- Consumes: `StateDoc` (Task 6).
- Produces:
  - `flap.js`: `CHARSET` (string), `padRight(s, n) → string`, `spinSteps(from, to, cap = 14) → number`, `makeFlapRow(n) → HTMLElement`, `setFlapRow(row, text, tint, baseDelay = 0) → void` where `tint` is `null | {kind:'form'} | {kind:'tier', color:string}`.
  - `fit.js`: `fitSize(text, available, measure, {max = 14, min = 8, step = 0.5}) → number`, and `canvasMeasurer(family, weight) → (text, px) => number`.
  - `board.js`:
    - `MODES` — array of `{ key, label, tint(player) }`, in cycle order `form, season, abandons, rank`.
    - `mountBoard(boardEl, headEl) → void` — **two arguments**: the board container and the header element the stat-name flaps live in.
    - `renderBoard(state, boardEl) → void` — second argument is the **element**, not a mode index. Rebuilds rows; call once per match.
    - `showMode(modeIndex) → void` — flaps the existing rows to that mode. Call on the 9s cycle; it does not rebuild the DOM.

Text measurement is injected rather than imported so `fit.js` is testable under `node --test` with no DOM. The browser passes a real `canvas.measureText`; tests pass a stub.

- [ ] **Step 1: Write the failing test for the flap arithmetic**

Create `tests/flap.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARSET, padRight, spinSteps } from '../overlay/flap.js';

test('values are right-justified into a fixed width', () => {
  assert.equal(padRight('4', 11),           '          4');
  assert.equal(padRight('147-117', 11),     '    147-117');
  assert.equal(padRight('ASCENDANT 6', 11), 'ASCENDANT 6');
  assert.equal(padRight('', 11).length, 11);
});

test('overlong values truncate from the left, keeping the significant end', () => {
  // right-justified, so the rightmost characters are the ones that matter
  assert.equal(padRight('ABCDEFGHIJKLM', 11), 'CDEFGHIJKLM');
  assert.equal(padRight('ABCDEFGHIJKLM', 11).length, 11);
});

test('the charset covers every glyph the board can display', () => {
  for (const ch of 'WL0123456789-%/ ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    assert.ok(CHARSET.includes(ch), `charset missing ${JSON.stringify(ch)}`);
  }
});

test('spin always moves and is capped', () => {
  assert.ok(spinSteps('A', 'A', 14) > 0, 'an unchanged glyph must still flap');
  assert.ok(spinSteps('A', 'B', 14) <= 14);
  assert.ok(spinSteps(' ', 'Z', 14) <= 14);
  for (const from of CHARSET) {
    for (const to of CHARSET) {
      const n = spinSteps(from, to, 14);
      assert.ok(n >= 1 && n <= 14, `spinSteps(${from},${to}) = ${n}`);
    }
  }
});

test('spin is deterministic — the same pair always gives the same count', () => {
  assert.equal(spinSteps('A', 'Q', 14), spinSteps('A', 'Q', 14));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/flap.test.js`
Expected: FAIL — cannot find module `../overlay/flap.js`.

- [ ] **Step 3: Write `overlay/flap.js`**

Cells are built once and never rebuilt — the constant-count rule from spec §5.3. Step counts are deterministic so they can be tested; the original implementation used `Math.random` and could not be.

```js
export const CHARSET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-%/';
const STEP_MS = 58;
const MAX_STEPS = 14;

/** Right-justify into exactly n chars. Overflow drops from the LEFT. */
export function padRight(s, n) {
  const t = String(s ?? '');
  return t.length > n ? t.slice(-n) : ' '.repeat(n - t.length) + t;
}

/** Deterministic: distance around the charset, always >= 1, capped. */
export function spinSteps(from, to, cap = MAX_STEPS) {
  const a = Math.max(0, CHARSET.indexOf(from));
  const b = Math.max(0, CHARSET.indexOf(to));
  const raw = (b - a + CHARSET.length) % CHARSET.length;
  return Math.min(raw === 0 ? 6 : raw, cap);
}

/** n cells, built once. Returns the row element. */
export function makeFlapRow(n) {
  const row = document.createElement('div');
  row.className = 'flaprow';
  for (let i = 0; i < n; i++) {
    const cell = document.createElement('span');
    cell.className = 'flap';
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.textContent = ' ';
    cell.appendChild(glyph);
    row.appendChild(cell);
  }
  return row;
}

function paint(cell, ch, tint) {
  cell.classList.remove('w', 'l', 'blank', 'tier');
  cell.style.removeProperty('--tier');
  if (ch === ' ') { cell.classList.add('blank'); return; }
  if (tint?.kind === 'form') {
    if (ch === 'W') cell.classList.add('w');
    else if (ch === 'L') cell.classList.add('l');
  } else if (tint?.kind === 'tier' && tint.color) {
    cell.classList.add('tier');
    cell.style.setProperty('--tier', tint.color);
  }
}

/** Flap the row to `text`, cascading left to right. */
export function setFlapRow(row, text, tint, baseDelay = 0) {
  const cells = row.children;
  const padded = padRight(text, cells.length);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const glyph = cell.firstChild;
    const target = padded[i];
    const steps = spinSteps(glyph.textContent, target);
    let k = 0;
    setTimeout(function step() {
      if (k >= steps) { glyph.textContent = target; paint(cell, target, tint); return; }
      k++;
      const from = Math.max(0, CHARSET.indexOf(glyph.textContent));
      glyph.textContent = k === steps ? target : CHARSET[(from + 1) % CHARSET.length];
      cell.classList.remove('flipping');
      void cell.offsetWidth;
      cell.classList.add('flipping');
      setTimeout(step, STEP_MS);
    }, baseDelay + i * 16);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/flap.test.js`
Expected: PASS, 5 tests. The DOM functions are not exercised here — only the arithmetic, which is the part that can be wrong silently.

- [ ] **Step 5: Write the failing test for name fitting**

Create `tests/fit.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitSize } from '../overlay/fit.js';

/** Stub measurer: Latin ~0.5em per char, CJK and emoji full-width ~1.0em. */
const measure = (text, px) => {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const wide = code > 0x2e80 || /[A-Z]/.test(ch);
    w += px * (wide ? 1.0 : 0.5);
  }
  return w;
};

const OPTS = { max: 14, min: 8, step: 0.5 };

test('a short name keeps the maximum size', () => {
  assert.equal(fitSize('bob', 169, measure, OPTS), 14);
});

test('a long name shrinks but never below the floor', () => {
  const size = fitSize('x'.repeat(40), 169, measure, OPTS);
  assert.ok(size < 14, 'must shrink');
  assert.ok(size >= 8, `must not go below the floor, got ${size}`);
});

test('an empty or missing name does not throw', () => {
  assert.equal(fitSize('', 169, measure, OPTS), 14);
  assert.equal(fitSize(null, 169, measure, OPTS), 14);
});
```

- [ ] **Step 6: Write `overlay/fit.js`**

```js
/**
 * Largest size in [min, max] at which `text` fits `available` px, stepping down
 * by `step`. Returns `min` if even that overflows — the caller then relies on
 * CSS ellipsis. `measure(text, px) -> width` is injected so this is testable
 * without a DOM.
 */
export function fitSize(text, available, measure, { max = 14, min = 8, step = 0.5 } = {}) {
  const t = String(text ?? '');
  if (!t) return max;
  let size = max;
  while (size > min && measure(t, size) > available) size -= step;
  return size;
}

/** Real measurer for the browser. Reuses one canvas. */
export function canvasMeasurer(family = 'Radiance, system-ui, sans-serif', weight = 600) {
  const ctx = document.createElement('canvas').getContext('2d');
  return (text, px) => {
    ctx.font = `${weight} ${px}px ${family}`;
    return ctx.measureText(text).width;
  };
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node --test tests/fit.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 8: Write `overlay/board.js`**

```js
import { makeFlapRow, setFlapRow } from './flap.js';
import { fitSize, canvasMeasurer } from './fit.js';

export const MODES = [
  { key: 'form',     label: 'FORM',     tint: () => ({ kind: 'form' }) },
  { key: 'season',   label: 'SEASON',   tint: () => null },
  { key: 'abandons', label: 'ABANDONS', tint: () => null },
  { key: 'rank',     label: 'RANK',     tint: p => ({ kind: 'tier', color: p.rankColor }) }
];

const CELLS = 11;
const HEAD = 8;
const NAME_COL = 169;   // 403 - 18 padding - 24 avatar - 16 gaps - 176 cells

let measure = null;
let headRow = null;
const rows = [];        // { player, nameEl, flapRow }

export function mountBoard(boardEl, headEl) {
  measure ??= canvasMeasurer();
  headRow = makeFlapRow(HEAD);
  headEl.replaceChildren(headRow);
  boardEl.replaceChildren();
  rows.length = 0;
}

function bandEl(team) {
  const band = document.createElement('div');
  band.className = 'band';
  band.style.setProperty('--band', `var(${team.colorVar})`);
  const label = document.createElement('span');
  label.textContent = team.faction;
  band.appendChild(label);
  return band;
}

function rowEl(player) {
  const row = document.createElement('div');
  row.className = 'prow' + (player.isSelf ? ' me' : '');

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  if (player.avatar) avatar.style.backgroundImage = `url(${player.avatar})`;

  const names = document.createElement('div');
  names.className = 'names';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = player.name;
  name.style.fontSize = `${fitSize(player.name, NAME_COL, measure)}px`;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `Hero ${player.heroId ?? '-'}`;
  names.append(name, sub);

  const flapRow = makeFlapRow(CELLS);
  row.append(avatar, names);
  if (player.isSelf) {
    const tag = document.createElement('span');
    tag.className = 'youtag';
    tag.textContent = 'YOU';
    row.appendChild(tag);
  }
  row.appendChild(flapRow);
  rows.push({ player, flapRow });
  return row;
}

/** Build the structure once per match, then only flap values. */
export function renderBoard(state, boardEl) {
  boardEl.replaceChildren();
  rows.length = 0;
  for (const team of state.teams) {
    boardEl.appendChild(bandEl(team));
    for (const p of team.players) boardEl.appendChild(rowEl(p));
  }
}

export function showMode(modeIndex) {
  const mode = MODES[modeIndex % MODES.length];
  setFlapRow(headRow, mode.label, null, 0);
  rows.forEach(({ player, flapRow }, i) => {
    setFlapRow(flapRow, player[mode.key], mode.tint(player), 130 + i * 46);
  });
}
```

- [ ] **Step 9: Write the failing test — pathological persona names**

This is **Review Focus item 1**. Append to `tests/fit.test.js`:

```js
test('32 full-width CJK characters shrink to the floor and never overflow', () => {
  const cjk = '超'.repeat(32);
  const size = fitSize(cjk, 169, measure, OPTS);
  assert.equal(size, 8, 'must bottom out at the floor');
  // at the floor it still overflows, which is correct: CSS ellipsis takes over
  assert.ok(measure(cjk, size) > 169,
    'the floor cannot fit this; the contract is that we stop shrinking, not that we fit');
});

test('32 wide capitals shrink rather than widening the column', () => {
  const caps = 'A'.repeat(32);
  const size = fitSize(caps, 169, measure, OPTS);
  assert.ok(size < 14 && size >= 8);
});

test('emoji-laden names behave like full-width text', () => {
  const emoji = '🔥'.repeat(20);
  const size = fitSize(emoji, 169, measure, OPTS);
  assert.ok(size >= 8 && size <= 14);
  assert.ok(Number.isFinite(size), 'must not return NaN for astral-plane glyphs');
});

test('a 32-char Latin name fits without shrinking much', () => {
  const latin = 'xX_ShadowReaperSniper420_Xxaaaaa'.slice(0, 32);
  const size = fitSize(latin, 169, measure, OPTS);
  assert.ok(size >= 8, 'stays in range');
});
```

The CSS must guarantee the ellipsis fallback. Append to `overlay/overlay.css`:

```css
/* --- board --- */
.band {
  display: flex; justify-content: space-between; padding: 5px 10px; flex: none;
  font-family: "Reaver", "Radiance", sans-serif; font-weight: 700;
  font-size: 9px; letter-spacing: .15em; text-transform: uppercase;
  color: var(--band); background: color-mix(in srgb, var(--band) 17%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--band) 42%, transparent);
}
.prow {
  position: relative; display: flex; align-items: center; gap: 8px;
  height: var(--row-height); padding: 0 9px;
  border-bottom: 1px solid rgba(255,239,215,.045);
}
.prow .avatar {
  width: 24px; height: 24px; flex: none; border-radius: 2px; border: 1px solid #6B5A46;
  background: linear-gradient(135deg,#5A4A3A,#30261D) center/cover no-repeat;
}
.prow .names { flex: 1; min-width: 0; overflow: hidden; }
/* the ellipsis fallback once fit.js has bottomed out at the floor */
.prow .name {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-weight: 600; line-height: 1.15;
}
.prow .sub { font-size: 9px; color: #6F6757; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.prow.me { background: linear-gradient(90deg, color-mix(in srgb, var(--team-amber) 20%, transparent) 0%, rgba(255,237,121,.05) 55%, transparent 100%); }
.prow.me::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--color-gold); }
.prow.me .name { color: var(--color-gold); font-weight: 700; }
.youtag {
  flex: none; font-size: 7px; font-weight: 800; letter-spacing: .13em;
  padding: 1px 3px; border-radius: 1px; color: #201500; background: var(--color-gold);
}

/* --- flap --- */
.flap {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: var(--flap-cell-w); height: var(--flap-cell-h); font-size: var(--flap-type);
  margin-left: 1px; border-radius: 1px; overflow: hidden; line-height: 1;
  font-family: "RadianceM", "Radiance", ui-monospace, monospace; font-weight: 600;
  color: var(--base-text);
  background: linear-gradient(180deg, #2E2A23 0%,
    #242019 calc(50% + var(--flap-seam)),
    #191610 calc(50% + var(--flap-seam) + 1px), #13100C 100%);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.6), 0 1px 0 rgba(255,239,215,.05);
}
.flap::after {
  content: ""; position: absolute; left: 0; right: 0; z-index: 3; height: 1px;
  top: calc(50% + var(--flap-seam));
  background: rgba(0,0,0,var(--flap-seam-op));
  box-shadow: 0 1px 0 rgba(255,239,215,.085);
}
.flap .glyph { display: block; transform-origin: center top; backface-visibility: hidden; }
.flap.flipping .glyph { animation: flap-step .058s linear; }
@keyframes flap-step {
  0% { transform: rotateX(0); filter: brightness(1); }
  49% { transform: rotateX(-82deg); filter: brightness(.45); }
  51% { transform: rotateX(82deg); filter: brightness(.45); }
  100% { transform: rotateX(0); filter: brightness(1); }
}
.flap.blank { background: linear-gradient(180deg, #242017 0%,
  #1B1710 calc(50% + var(--flap-seam)),
  #141009 calc(50% + var(--flap-seam) + 1px), #100D07 100%); }
.flap.tier { color: var(--tier, var(--color-gold)); }
.flap.w { color: #112A1C; background: linear-gradient(180deg, #6FF0AB 0%,
  #43C47F calc(50% + var(--flap-seam)),
  #36A96C calc(50% + var(--flap-seam) + 1px), #2A8A57 100%); }
.flap.l { color: #2E0F08; background: linear-gradient(180deg, #FFA184 0%,
  #E5664A calc(50% + var(--flap-seam)),
  #C9503A calc(50% + var(--flap-seam) + 1px), #A53C2B 100%); }
.flap.w::after, .flap.l::after {
  background: rgba(0,0,0,calc(var(--flap-seam-op) * .65));
  box-shadow: 0 1px 0 rgba(255,255,255,.18);
}
#board-head .flap { width: 16px; height: 21px; font-size: 12px;
  background: linear-gradient(180deg, #4A3718 0%,
    #2D2109 calc(50% + var(--flap-seam)),
    #35270C calc(50% + var(--flap-seam) + 1px), #1E1506 100%);
  color: var(--color-gold); }
```

- [ ] **Step 10: Run the tests and wire the board into `app.js`**

Run: `npm test`
Expected: PASS.

Replace `overlay/app.js`:

```js
import { mountLogo } from './logo.js';
import { mountBoard, renderBoard, showMode } from './board.js';

const el = id => document.getElementById(id);

const state = await fetch('/fixture').then(r => r.json());

await mountLogo(el('logo-bay'));
mountBoard(el('board'), el('stat-name'));
renderBoard(state, el('board'));

let mode = 0;
showMode(mode);
setInterval(() => showMode(++mode), 9000);
```

- [ ] **Step 11: Verify in a browser**

Run `npm run serve`, open `http://localhost:7331/`. Expected: twelve rows under two faction bands, values flapping in a left-to-right cascade, cycling FORM → SEASON → ABANDONS → RANK every 9s. FORM fills all eleven cells; SEASON and ABANDONS show blanks to the left; RANK is tinted per tier.

Check that the rail width never changes as the mode cycles. If it does, a value is exceeding 11 characters and `padRight` is not being applied.

- [ ] **Step 12: Commit**

```bash
git add overlay/flap.js overlay/fit.js overlay/board.js overlay/overlay.css overlay/app.js tests/flap.test.js tests/fit.test.js
git commit -m "feat: split-flap board with fixed cells and name auto-fit"
```

---

### Task 9: Chiron

**Files:**
- Create: `overlay/chiron.js`
- Modify: `overlay/overlay.css` (append chiron styles)
- Modify: `overlay/app.js`

**Interfaces:**
- Consumes: `StateDoc` (Task 6).
- Produces: `mountChiron(els)`, `renderTurn(state, turnIndex)`, `TURNS`.

Five themed turns at 9s each is a 45s cycle. Four groups per turn, each a small label over a large value — stacked to use the full 135px, which is what makes four groups legible rather than cramped.

- [ ] **Step 1: Write `overlay/chiron.js`**

```js
/** Five themed turns, spec section 6.2. Each picks 4 groups from the state. */
export const TURNS = [
  { spine: 'Session', sub: 'Deadlock', groups: s => [
    ['Today',      s.session.todayRecord ?? '-', s.session.winRateToday ?? ''],
    ['K / D',      s.session.kd ?? '-',          ''],
    ['Matches',    s.session.matches ?? '-',     ''],
    ['Rank',       s.session.rank ?? '-',        s.session.rankProgress ?? '']
  ] },
  { spine: 'Hero', sub: 'Form', groups: s => {
    const me = self(s);
    return [
      ['Hero',     `Hero ${me?.heroId ?? '-'}`, `${me?.matches ?? 0} matches`],
      ['Season',   me?.season ?? '-',           ''],
      ['K / D',    me?.kd ?? '-',               ''],
      ['Streak',   me?.streak ?? '-',           '']
    ];
  } },
  { spine: 'Standing', sub: 'Rank', groups: s => {
    const me = self(s);
    return [
      ['Rank',     me?.rank ?? '-',       ''],
      ['Net worth',me?.netWorth ?? '-',   'average'],
      ['Last hits',me?.lastHits ?? '-',   'average'],
      ['Denies',   me?.denies ?? '-',     'average']
    ];
  } },
  { spine: 'Matchup', sub: 'Lane', groups: s => {
    const them = s.teams[1]?.players ?? [];
    return them.slice(0, 4).map(p => [p.name.slice(0, 14), p.season, p.rank]);
  } },
  { spine: 'Records', sub: 'Watch', groups: s => {
    const me = self(s);
    return [
      ['Streak',   me?.streak ?? '-',     ''],
      ['Abandons', me?.abandons ?? '0',   'all time'],
      ['Matches',  me?.matches ?? '-',    'tracked'],
      ['Form',     (me?.form ?? '').trim() || '-', 'last 11']
    ];
  } }
];

const self = s => s.teams.flatMap(t => t.players).find(p => p.isSelf)
            ?? s.teams[0]?.players[0];

/**
 * Element builders. These exist so no API-sourced string is ever parsed as
 * HTML. `textContent` assigns text, full stop — a persona name of
 * `<img src=x onerror=alert(1)>` renders as those literal characters.
 */
function div(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = String(text ?? '');
  return d;
}

function punit(label, value) {
  const u = document.createElement('div');
  u.className = 'punit';
  u.append(div('plabel', label), div('pvalue', value));
  return u;
}

let els = null;
let currentRow = null;

export function mountChiron(refs) { els = refs; }

export function renderTurn(state, turnIndex) {
  if (!els) return;
  const turn = TURNS[turnIndex % TURNS.length];

  els.spine.replaceChildren(
    div('spine-sub', turn.sub),
    div('spine-title', turn.spine)
  );

  const me = self(state);
  els.persistent.replaceChildren(
    punit('Today', state.session.todayRecord ?? '-'),
    punit('Rank', me?.rank ?? '-')
  );

  if (currentRow) {
    const old = currentRow;
    old.classList.add('out');
    setTimeout(() => old.remove(), 440);
  }

  const row = document.createElement('div');
  row.className = 'grouprow';
  let groups;
  try { groups = turn.groups(state); } catch { groups = []; }
  groups.slice(0, 4).forEach(([label, value, sub], i) => {
    const g = document.createElement('div');
    g.className = 'group' + (i === 0 ? ' lead' : '');
    g.style.animationDelay = `${120 + i * 70}ms`;
    // textContent, never innerHTML: `label` carries Steam persona names on the
    // Matchup turn, and those are attacker-controlled by every player in the
    // match. See the security note in this task.
    g.append(div('glabel', label), div('gvalue', value));
    if (sub) g.appendChild(div('gsub', sub));
    row.appendChild(g);
  });
  els.groups.appendChild(row);
  void row.offsetWidth;
  row.classList.add('in');
  currentRow = row;
}
```

- [ ] **Step 2: Append chiron styles to `overlay/overlay.css`**

```css
/* --- chiron --- */
#spine {
  flex: none; width: 104px; padding: 0 12px; display: flex; flex-direction: column;
  justify-content: center; gap: 2px;
  border-right: 1px solid #453D2E; background: rgba(0,0,0,.16);
}
.spine-sub { font-size: 8px; letter-spacing: .16em; text-transform: uppercase; color: #A3814A; font-weight: 800; }
.spine-title { font-family: "Reaver", "Radiance", sans-serif; font-weight: 700; font-size: 15px; color: var(--color-gold); line-height: 1.05; }

#groups { flex: 1; min-width: 0; position: relative; }
.grouprow {
  position: absolute; inset: 0; display: flex; align-items: center; padding: 0 6px;
  transform: translateY(100%); opacity: 0;
}
.grouprow.in { animation: roll-in .5s cubic-bezier(.2,.9,.28,1) forwards; }
.grouprow.out { animation: roll-out .42s cubic-bezier(.6,0,.75,.2) forwards; }
@keyframes roll-in { to { transform: translateY(0); opacity: 1; } }
@keyframes roll-out { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-100%); opacity: 0; } }

.group {
  flex: 1; min-width: 0; padding: 0 16px; display: flex; flex-direction: column;
  justify-content: center; gap: 3px; border-left: 1px solid rgba(255,239,215,.09);
  opacity: 0; transform: translateY(26%);
  animation: group-in .36s cubic-bezier(.2,.9,.28,1) forwards;
}
.group:first-child { border-left: none; }
@keyframes group-in { to { opacity: 1; transform: translateY(0); } }
.glabel { font-size: 9px; letter-spacing: .17em; text-transform: uppercase; color: #A3814A; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gvalue { font-family: "RadianceM", "Radiance", ui-monospace, monospace; font-weight: 600; font-size: 23px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.group.lead .gvalue { color: var(--color-gold); }
.gsub { font-size: 8px; color: #6F6757; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

#persistent {
  flex: none; display: flex; gap: 14px; align-items: center; padding: 0 15px;
  border-left: 1px solid #453D2E; background: rgba(0,0,0,.22);
}
.punit { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.plabel { font-size: 7px; letter-spacing: .16em; text-transform: uppercase; color: #A3814A; font-weight: 800; }
.pvalue { font-family: "RadianceM", "Radiance", ui-monospace, monospace; font-weight: 700; font-size: 19px; color: var(--color-gold); line-height: 1; }
```

- [ ] **Step 3: Wire it into `overlay/app.js`**

```js
import { mountLogo } from './logo.js';
import { mountBoard, renderBoard, showMode } from './board.js';
import { mountChiron, renderTurn } from './chiron.js';

const el = id => document.getElementById(id);
const state = await fetch('/fixture').then(r => r.json());

await mountLogo(el('logo-bay'));
mountBoard(el('board'), el('stat-name'));
renderBoard(state, el('board'));
mountChiron({ spine: el('spine'), groups: el('groups'), persistent: el('persistent') });

let mode = 0, turn = 0;
showMode(mode);
renderTurn(state, turn);
setInterval(() => showMode(++mode), 9000);
setInterval(() => renderTurn(state, ++turn), 9000);
```

- [ ] **Step 4: Verify in a browser**

Run `npm run serve`, open `http://localhost:7331/`. Expected: the chiron cycles five themed turns every 9s, four groups per turn rolling up with a ~70ms per-group stagger, the spine word changing in Reaver, and the persistent zone at the right holding Today and Rank without rolling.

Confirm the chiron is motionless for most of each 9s hold — that stillness is the point, per spec §6.1.

- [ ] **Step 5: Write the injection regression test**

The Matchup turn puts Steam persona names in the `label` position, and a
persona name is attacker-controlled by **every player in the match, opponents
included**. A name of `<img src=x onerror=…>` reaching an `innerHTML` sink
would execute in the overlay page — which runs inside OBS's Chromium with
reach to the local proxy. The realistic attack is defacing a live broadcast by
renaming yourself.

The renderers already use `textContent`. This test stops that silently
regressing, and needs no DOM:

Create `tests/injection.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The overlay renders Steam persona names, which are attacker-controlled.
 * Only logo.js may use innerHTML, and only to inject the three SVG layers we
 * vendor ourselves into overlay/logo/ — never anything from the API.
 */
const API_FACING = ['overlay/chiron.js', 'overlay/board.js', 'overlay/app.js'];

for (const file of API_FACING) {
  test(`${file} has no innerHTML sink`, () => {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /\binnerHTML\b/,
      `${file} renders API-sourced strings; use textContent, not innerHTML`);
  });

  test(`${file} does not use insertAdjacentHTML or document.write either`, () => {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /insertAdjacentHTML|document\.write|outerHTML\s*=/,
      `${file} must not parse strings as HTML`);
  });
}

test('logo.js innerHTML is confined to locally vendored SVG', () => {
  const src = readFileSync('overlay/logo.js', 'utf8');
  // It may use innerHTML, but only on text fetched from our own logo/ dir.
  assert.match(src, /fetch\(`logo\/\$\{name\}\.svg`\)|fetch\('logo\//,
    'logo.js must read its SVG from the vendored local directory');
  assert.doesNotMatch(src, /api\.deadlock-api\.com|assets-bucket/,
    'logo.js must not fetch SVG from the network at runtime');
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/injection.test.js`
Expected: PASS, 7 tests. If any fails, the renderer in question is building
markup from strings — replace it with `createElement` + `textContent`.

- [ ] **Step 7: Verify a hostile name renders inertly**

With the server running, confirm by hand that a malicious persona name is
displayed rather than executed. Temporarily edit one name in
`fixtures/steam.sample.json`:

```bash
node -e "
  const fs = require('fs');
  const f = 'fixtures/steam.sample.json';
  const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
  rows[0].personaname = '<img src=x onerror=\"document.body.style.background=1\">';
  fs.writeFileSync(f + '.bak', JSON.stringify(JSON.parse(fs.readFileSync(f,'utf8')), null, 2));
  fs.writeFileSync(f, JSON.stringify(rows, null, 2));
  console.log('injected a hostile name into row 0; backup at ' + f + '.bak');
"
```

Reload `http://localhost:7331/?fixture`. Expected: the literal characters
`<img src=x onerror=...>` appear in the board row, the page background is
unchanged, and the browser console shows no errors. Then restore:

```bash
mv fixtures/steam.sample.json.bak fixtures/steam.sample.json
```

- [ ] **Step 8: Commit**

```bash
git add overlay/chiron.js overlay/overlay.css overlay/app.js tests/injection.test.js
git commit -m "feat: chiron with themed turns, plus an injection regression gate"
```

---

### Task 10: Stat registry and salience

**Files:**
- Create: `proxy/registry.js`
- Modify: `proxy/state.js` (attach `salient` to the state document)
- Test: `tests/registry.test.js`

**Interfaces:**
- Consumes: `StateDoc` (Task 6).
- Produces:
  - `STATS` — array of `{ key, label, minSample, compute(state) → {value, sample, baseline}|null, salience(c) → number }`.
  - `rankStats(state) → [{ key, label, value, salience }]`, descending, excluding anything below its `minSample`.

The sample floor is the important half. "5–1 against this player" is the most tempting line available and the least trustworthy — six games is noise — and a floor is what stops the overlay narrating randomness.

- [ ] **Step 1: Write the failing test**

Create `tests/registry.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATS, rankStats } from '../proxy/registry.js';

const stateWith = over => ({
  phase: 'MATCH',
  session: {},
  teams: [{ faction: 'Hidden King', colorVar: '--team-amber', players: [
    { isSelf: true, name: 'me', season: '147-117', matches: '264',
      streak: 'W4', kd: '2.4', abandons: '0', rank: 'ORACLE 5',
      netWorth: '71.2k', lastHits: '214', denies: '14', form: 'WWLWWLWWWL ',
      ...over }
  ] }, { faction: 'Archmother', colorVar: '--team-sapphire', players: [] }],
  generatedAt: 0
});

test('every stat declares the full contract', () => {
  assert.ok(STATS.length > 0);
  for (const s of STATS) {
    assert.equal(typeof s.key, 'string');
    assert.equal(typeof s.label, 'string');
    assert.equal(typeof s.minSample, 'number');
    assert.equal(typeof s.compute, 'function');
    assert.equal(typeof s.salience, 'function');
  }
});

test('a stat below its sample floor never airs', () => {
  const thin = stateWith({ matches: '3' });
  const keys = rankStats(thin).map(s => s.key);
  assert.ok(!keys.includes('seasonWinRate'),
    'a 3-match season must not be presented as a win rate');
});

test('a stat above its floor does air', () => {
  const keys = rankStats(stateWith({})).map(s => s.key);
  assert.ok(keys.includes('seasonWinRate'));
});

test('results are sorted by descending salience', () => {
  const ranked = rankStats(stateWith({}));
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].salience >= ranked[i].salience,
      'must be descending');
  }
});

test('a longer streak is more salient than a shorter one', () => {
  const find = (st, key) => rankStats(st).find(s => s.key === key)?.salience ?? 0;
  assert.ok(find(stateWith({ streak: 'W6' }), 'streak')
          > find(stateWith({ streak: 'W2' }), 'streak'));
});

test('an empty or malformed state yields no stats rather than throwing', () => {
  assert.deepEqual(rankStats({ teams: [], session: {} }), []);
  assert.deepEqual(rankStats({}), []);
  assert.deepEqual(rankStats(null), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/registry.test.js`
Expected: FAIL — cannot find module `../proxy/registry.js`.

- [ ] **Step 3: Write `proxy/registry.js`**

```js
/**
 * Stat candidates. Each declares how to compute itself, the minimum sample
 * below which it must never air, and a salience score — roughly, how far it
 * deviates from its own baseline.
 *
 * Tier membership means ELIGIBLE TO AIR, not always on screen. That is what
 * makes ~35 stats tractable. See spec section 7.1.
 */

const self = state =>
  (state?.teams ?? []).flatMap(t => t?.players ?? []).find(p => p?.isSelf) ?? null;

const int = v => {
  const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

/** Season win rate as a fraction, from a '147-117' string. */
function winRate(seasonText) {
  const [w, l] = String(seasonText ?? '').split('-').map(int);
  const total = w + l;
  return total ? w / total : null;
}

export const STATS = [
  {
    key: 'seasonWinRate', label: 'Season win rate', minSample: 20,
    compute(state) {
      const me = self(state);
      if (!me) return null;
      const rate = winRate(me.season);
      if (rate === null) return null;
      return { value: `${Math.round(rate * 100)}%`, sample: int(me.matches), baseline: 0.5 };
    },
    // distance from a coin flip, normalised so 50% -> 0 and 100% -> 1
    salience: c => Math.min(1, Math.abs(parseInt(c.value, 10) / 100 - c.baseline) * 2)
  },
  {
    key: 'streak', label: 'Win streak', minSample: 3,
    compute(state) {
      const me = self(state);
      if (!me?.streak) return null;
      const n = int(me.streak);
      return { value: me.streak, sample: n, baseline: 2 };
    },
    // a 3-streak is unremarkable; by 8 it is the story
    salience: c => Math.min(1, Math.max(0, (c.sample - c.baseline) / 6))
  },
  {
    key: 'abandons', label: 'Abandons', minSample: 1,
    compute(state) {
      const me = self(state);
      if (!me) return null;
      const n = int(me.abandons);
      if (n === 0) return null;           // zero is not news
      return { value: String(n), sample: n, baseline: 0 };
    },
    salience: c => Math.min(1, c.sample / 10)
  },
  {
    key: 'kd', label: 'K/D', minSample: 20,
    compute(state) {
      const me = self(state);
      if (!me) return null;
      const kd = parseFloat(me.kd);
      if (!Number.isFinite(kd)) return null;
      return { value: me.kd, sample: int(me.matches), baseline: 1.0 };
    },
    salience: c => Math.min(1, Math.abs(parseFloat(c.value) - c.baseline) / 2)
  }
];

/** Eligible candidates, most salient first. Never throws. */
export function rankStats(state) {
  const out = [];
  for (const stat of STATS) {
    let c = null;
    try { c = stat.compute(state); } catch { c = null; }
    if (!c) continue;
    if (c.sample < stat.minSample) continue;     // the floor
    let s = 0;
    try { s = stat.salience(c); } catch { s = 0; }
    if (!Number.isFinite(s)) s = 0;
    out.push({ key: stat.key, label: stat.label, value: c.value, sample: c.sample, salience: s });
  }
  return out.sort((a, b) => b.salience - a.salience);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/registry.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Attach salient stats to the state document**

Two edits to `proxy/state.js`.

**(a)** Add the import at the top of the file, below the existing imports:

```js
import { rankStats } from './registry.js';
```

**(b)** Replace the whole `return { ... }` at the end of `buildState` with a two-pass build. Salience has to read the *finished* player rows, so the document must exist before it is scored:

```js
  const doc = {
    phase: 'MATCH',
    matchId: match.match_id ?? null,
    factions: FACTIONS,
    teams: [
      { faction: FACTIONS.amber, colorVar: '--team-amber', players: bucket.amber },
      { faction: FACTIONS.sapphire, colorVar: '--team-sapphire', players: bucket.sapphire }
    ],
    session,
    generatedAt: now,
    salient: []
  };
  doc.salient = rankStats(doc);
  return doc;
```

**(c)** In `emptyState`, add `salient: []` alongside `session: {}` so every document has the same shape:

```js
    session: {}, salient: [], generatedAt: Date.now()
```

- [ ] **Step 6: Confirm the state tests still pass**

Run: `npm test`
Expected: PASS. Then check the live shape:

```bash
npm run serve &
curl -s http://localhost:7331/fixture | node -e "
  const s = JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log(s.salient.map(x => x.key + ' ' + x.salience.toFixed(2)).join('  '));
"
```

Expected: a descending list such as `seasonWinRate 0.09  kd 0.70`. An empty list is legitimate if the fixture subject is unremarkable — it means the floors are doing their job.

- [ ] **Step 7: Commit**

```bash
git add proxy/registry.js proxy/state.js tests/registry.test.js
git commit -m "feat: stat registry with sample floors and salience ranking"
```

---

### Task 11: State machine and transitions

**Files:**
- Create: `overlay/machine.js`
- Modify: `overlay/overlay.css` (append ident styles)
- Modify: `overlay/app.js` (poll `/state`, drive transitions)
- Test: `tests/machine.test.js`

**Interfaces:**
- Consumes: `StateDoc.phase`, `StateDoc.matchId`.
- Produces: `nextTransition(prev, next) → 'sweep' | 'ident' | null`, `mountMachine(els)`, `runTransition(kind, mark)`.

Two transitions, because there are only two kinds of boundary: one where gameplay is live and must stay visible, and one where it is not.

- [ ] **Step 1: Write the failing test**

Create `tests/machine.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTransition } from '../overlay/machine.js';

const s = (phase, matchId = null) => ({ phase, matchId });

test('entering a match sweeps — nothing may be occluded', () => {
  assert.equal(nextTransition(s('QUEUE'), s('MATCH', 1)), 'sweep');
  assert.equal(nextTransition(s('IDLE'), s('MATCH', 1)), 'sweep');
});

test('a match ending runs the ident — full cover is free there', () => {
  assert.equal(nextTransition(s('MATCH', 1), s('RECAP', 1)), 'ident');
  assert.equal(nextTransition(s('RECAP', 1), s('IDLE')), 'ident');
});

test('no phase change means no transition', () => {
  assert.equal(nextTransition(s('MATCH', 1), s('MATCH', 1)), null);
  assert.equal(nextTransition(s('IDLE'), s('IDLE')), null);
});

test('a new match id while already in MATCH sweeps rather than doing nothing', () => {
  assert.equal(nextTransition(s('MATCH', 1), s('MATCH', 2)), 'sweep',
    'back-to-back games must not render the old roster');
});

test('a null or first state does not transition', () => {
  assert.equal(nextTransition(null, s('MATCH', 1)), null);
  assert.equal(nextTransition(undefined, s('IDLE')), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/machine.test.js`
Expected: FAIL — cannot find module `../overlay/machine.js`.

- [ ] **Step 3: Write `overlay/machine.js`**

```js
import { sweepLogo } from './logo.js';

/**
 * Which transition a phase change calls for.
 *   sweep — 1.1s, occludes nothing. For boundaries where gameplay is live.
 *   ident — 1.9s, full cover. Only where there is no live gameplay to hide.
 * See spec section 6.5.
 */
export function nextTransition(prev, next) {
  if (!prev || !next) return null;

  // a different match while still in MATCH is a boundary too
  if (prev.phase === 'MATCH' && next.phase === 'MATCH') {
    return prev.matchId !== next.matchId ? 'sweep' : null;
  }
  if (prev.phase === next.phase) return null;

  if (next.phase === 'MATCH') return 'sweep';
  if (next.phase === 'RECAP' || next.phase === 'IDLE' || next.phase === 'QUEUE') return 'ident';
  return null;
}

let els = null;

export function mountMachine(refs) { els = refs; }

/** Fires the chosen transition. Resolves when the screen is usable again. */
export function runTransition(kind, mark) {
  if (kind === 'sweep') {
    sweepLogo(mark);
    return new Promise(r => setTimeout(r, 1150));
  }
  if (kind === 'ident' && els) {
    els.veil.classList.add('run');
    els.ident.classList.add('run');
    return new Promise(r => setTimeout(() => {
      els.veil.classList.remove('run');
      els.ident.classList.remove('run');
      r();
    }, 1950));
  }
  return Promise.resolve();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/machine.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Append ident styles to `overlay/overlay.css`**

```css
/* --- eye ident: the mark grows out of the bay, the eye shuts, it recedes --- */
#veil.run { animation: ident-veil var(--xition-ident) ease-in-out; }
@keyframes ident-veil { 0% { opacity: 0; } 34%, 62% { opacity: 1; } 100% { opacity: 0; } }

#ident.run { animation: ident-fade var(--xition-ident) ease-in-out; }
@keyframes ident-fade { 0% { opacity: 0; } 20%, 78% { opacity: 1; } 100% { opacity: 0; } }

#ident .mark { width: 300px; }
#ident.run .mark { animation: ident-grow var(--xition-ident) cubic-bezier(.4,.02,.3,1); }
@keyframes ident-grow {
  0%   { transform: translate(-760px, 420px) scale(.32); }
  40%  { transform: translate(0, 0) scale(2.6); }
  60%  { transform: translate(0, 0) scale(2.6); }
  100% { transform: translate(-760px, 420px) scale(.32); }
}
#ident.run .mark .eye { animation: ident-shut var(--xition-ident) ease-in-out; }
@keyframes ident-shut {
  0%, 34% { transform: scaleY(1); }
  46%, 54% { transform: scaleY(.04); }
  66%, 100% { transform: scaleY(1); }
}
#ident.run .mark .outer { animation: ident-spin var(--xition-ident) cubic-bezier(.4,.02,.3,1); }
@keyframes ident-spin { from { transform: rotate(0); } to { transform: rotate(200deg); } }
```

- [ ] **Step 6: Rewrite `overlay/app.js` to poll `/state`**

```js
import { mountLogo } from './logo.js';
import { mountBoard, renderBoard, showMode } from './board.js';
import { mountChiron, renderTurn } from './chiron.js';
import { mountMachine, nextTransition, runTransition } from './machine.js';

const el = id => document.getElementById(id);

// ?fixture develops the whole visual layer with no game running
const SOURCE = new URLSearchParams(location.search).has('fixture') ? '/fixture' : '/state';
const POLL_MS = 2000;

const mark = await mountLogo(el('logo-bay'));
await mountLogo(el('ident'));                    // a second mark for the ident
mountBoard(el('board'), el('stat-name'));
mountChiron({ spine: el('spine'), groups: el('groups'), persistent: el('persistent') });
mountMachine({ veil: el('veil'), ident: el('ident') });

let state = null;
let mode = 0, turn = 0;

async function poll() {
  let next;
  try {
    next = await fetch(SOURCE, { cache: 'no-store' }).then(r => r.json());
  } catch {
    return;            // never render a hole: keep the last good document
  }

  const kind = nextTransition(state, next);
  if (kind) {
    const swap = () => {
      state = next;
      renderBoard(state, el('board'));
      showMode(mode);
      renderTurn(state, turn);
    };
    // the ident fully covers the frame, so swap under it at the peak
    if (kind === 'ident') setTimeout(swap, 800); else swap();
    await runTransition(kind, mark);
  } else if (!state) {
    state = next;
    renderBoard(state, el('board'));
    showMode(mode);
    renderTurn(state, turn);
  } else {
    state = next;
  }
}

await poll();
setInterval(poll, POLL_MS);
setInterval(() => { if (state) showMode(++mode); }, 9000);
setInterval(() => { if (state) renderTurn(state, ++turn); }, 9000);
```

- [ ] **Step 7: Verify both transitions by hand**

Run `npm run serve`, open `http://localhost:7331/?fixture`.

To see the transitions without a real match, temporarily force them from the browser console:

```js
// in DevTools
const { nextTransition, runTransition } = await import('/machine.js');
const mark = document.querySelector('#logo-bay .mark');
await runTransition('sweep', mark);     // ring turns 180 degrees, nothing covered
await runTransition('ident', mark);     // mark grows, eye shuts, screen clears
```

Expected: the sweep turns the bay's ring a half-turn and occludes nothing. The ident grows a second copy of the mark out of the bay to centre-frame, shuts the eye, blacks out, and recedes.

- [ ] **Step 8: Commit**

```bash
git add overlay/machine.js overlay/overlay.css overlay/app.js tests/machine.test.js
git commit -m "feat: state machine with logo sweep and eye ident transitions"
```

---

### Task 12: Failure-mode hardening

**Files:**
- Modify: `proxy/server.js`
- Modify: `proxy/state.js`
- Test: `tests/failure.test.js`

**Interfaces:**
- Consumes: everything prior.
- Produces: `fallbackState(prev, reason) → StateDoc`.

Spec §9's single rule: **never render a hole.** Every failure degrades to something a viewer reads as intentional. A spinner or empty panel on a broadcast is worse than slightly stale numbers, and a real network never captions which feed failed.

- [ ] **Step 1: Write the failing test**

Create `tests/failure.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildState, emptyState, fallbackState } from '../proxy/state.js';
import { derivePlayer } from '../proxy/derive.js';

const load = f => JSON.parse(readFileSync(`fixtures/${f}`, 'utf8'));
const match = load('active.sample.json');
const history = load('match-history.sample.json');
const stats = derivePlayer(history);
const good = buildState({
  match, steam: load('steam.sample.json'), ranks: load('rank.sample.json'),
  derived: new Map(match.players.map(p => [p.account_id, stats]))
});

test('a fallback keeps the last good roster rather than blanking', () => {
  const f = fallbackState(good, 'api down');
  assert.equal(f.teams[0].players.length, 6);
  assert.equal(f.teams[1].players.length, 6);
  assert.equal(f.stale, true);
});

test('a fallback with no previous state is still renderable', () => {
  const f = fallbackState(null, 'cold start');
  assert.equal(f.phase, 'IDLE');
  assert.ok(Array.isArray(f.teams));
  assert.equal(f.teams.length, 2);
});

test('no state document ever contains undefined, NaN or null names', () => {
  for (const doc of [good, emptyState('x'), fallbackState(good, 'y'), fallbackState(null, 'z')]) {
    const json = JSON.stringify(doc);
    assert.doesNotMatch(json, /NaN/, 'NaN leaked into the document');
    assert.doesNotMatch(json, /"name":\s*(null|"")/, 'an empty name leaked');
  }
});

test('malformed upstream payloads degrade instead of throwing', () => {
  for (const bad of [{}, { players: [] }, { players: null }, null, undefined]) {
    const doc = buildState({ match: bad, steam: [], ranks: [], derived: new Map() });
    assert.equal(doc.phase, 'IDLE');
    assert.equal(doc.teams.length, 2);
  }
});

test('garbage in the batch responses does not break the board', () => {
  const doc = buildState({
    match, steam: [null, { nope: 1 }], ranks: 'not an array',
    derived: new Map()
  });
  const all = doc.teams.flatMap(t => t.players);
  assert.equal(all.length, 12);
  for (const p of all) {
    assert.equal(p.form.length, 11);
    assert.ok(p.name.length > 0);
    assert.doesNotMatch(p.rank, /undefined/);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/failure.test.js`
Expected: FAIL — `fallbackState` is not exported. The `garbage in the batch responses` test may also fail if `indexBy` does not tolerate a non-array.

- [ ] **Step 3: Add `fallbackState` and harden `indexBy`**

In `proxy/state.js`, replace `indexBy` with:

```js
function indexBy(rows, key) {
  const m = new Map();
  if (!Array.isArray(rows)) return m;      // a string or object upstream must not throw
  for (const r of rows) {
    if (r && typeof r === 'object' && key in r) m.set(r[key], r);
  }
  return m;
}
```

and append:

```js
/**
 * Serve the last good document rather than nothing. Spec section 9: never
 * render a hole. `stale` is for our logs — the overlay does not surface it,
 * because a real network never captions which feed failed.
 */
export function fallbackState(previous, reason = '') {
  if (previous?.teams?.length) {
    return { ...previous, stale: true, reason };
  }
  return { ...emptyState(reason), stale: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/failure.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Use the fallback in the server's refresh loop**

In `proxy/server.js`, add `fallbackState` to the import from `./state.js`, then replace the `catch` block in `refresh()`:

```js
  } catch (err) {
    console.error('[refresh]', err.message);
    current = fallbackState(current, err.message);
  }
```

- [ ] **Step 6: Verify the degraded path by hand**

Start the server, confirm `/state` responds, then take the network away — on Windows, disable the adapter briefly, or point the client at a dead host:

```bash
DSN_ACCOUNT_ID=0 npm run serve
```

With `ACCOUNT_ID` unset the detector finds no match, so `/state` should report `phase: "IDLE"` with two empty teams and **no error text**. Open `http://localhost:7331/` and confirm the overlay shows its chrome — rail, chiron, logo, all intact — rather than a blank page or a stack trace.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS across all nine test files.

- [ ] **Step 8: Commit**

```bash
git add proxy/state.js proxy/server.js tests/failure.test.js
git commit -m "feat: degrade to last-known-good state on every failure path"
```

---

## OBS setup

Not a build task, but the plan is not done until the thing runs where it is meant to.

**Requires OBS Studio 31.0 or newer.** Older builds bundle a CEF whose Chromium
predates `color-mix()` (Chromium 111) and `:has()` (105), and the failure mode is
silent: the faction bands render **invisible** with no console error. Current
stable OBS is 32.2.2 (Chromium 127), comfortably past both. Check via
*Help → About*.

1. `npm run serve` with `DSN_ACCOUNT_ID` set to your SteamID3 numeric part.
2. In OBS, add a **Browser Source**: URL `http://localhost:7331/`, width `1920`, height `1080`, and **uncheck** "Shutdown source when not visible" so the page is not reloaded on every scene switch.
3. Add your **Game Capture** *below* the browser source in the source list, and scale it to `1517 × 945` positioned at `0, 0` — the transparent region the overlay leaves for it.
4. Add your **camera** source above the browser source, scaled to `403 × 227` at `1517, 0`.

Source order matters: sources higher in the list render on top.

---

## Deferred

- **Palette source** — `--team-amber` / `--team-sapphire` in `tokens.css` currently alias the citadel pair. Swapping to the brighter generic-data pair (`#E7B659` / `#5B79E6`) is a two-line change in one file.
- **`TEAM0_IS_AMBER`** — verify against one real match, then delete the comment in `proxy/config.js`.
- **Session tier** — `state.session` is populated as an empty object. Wiring `/v1/commands/resolve` (60 req/60s, 42 prebuilt variables) fills the chiron's Session turn and the persistent zone with real values rather than `-`.
- **Context and recap tiers** — `/v1/analytics/*` and `/v1/matches/{id}/metadata`. Both are cheap and additive; neither changes any interface defined here.
