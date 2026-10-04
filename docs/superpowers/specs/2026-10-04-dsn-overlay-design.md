# DSN — Deadlock Sports Network Overlay

**Design specification**
Date: 2026-10-04
Status: approved in design, pending three leaf decisions (§11)

---

## 1. Purpose

A Twitch streaming overlay for Valve's *Deadlock* that presents a live match the way a sports
network presents a game: persistent chrome, a lower-third chiron, a statistics rail, and
comparative context around the play rather than a restatement of it.

The visual grammar is ESPN — layout hierarchy, lower-third anatomy, stat-strip pacing. The
visual language is Deadlock's own: its real palette, its real typefaces, its art-deco/brass
register. These are aesthetically opposed on their own, and the synthesis is deliberately
"a sports broadcast that exists inside Deadlock's world", not ESPN red-and-blue applied to a
game capture.

**Audience.** Single operator (the repo owner) first. The identity and configuration boundary is
kept clean so a second user is a config change rather than a rewrite, but no multi-tenancy,
accounts, or hosted control plane is built.

**Success criteria.**

- Runs as one OBS browser source at 1920×1080 with no plugin.
- Requires no interaction during a match — hands stay on WASD.
- Never renders a visibly broken state on stream, under any upstream failure.
- Surfaces stats that are *contextual* (how does this compare?) rather than duplicating the
  in-game HUD.

---

## 2. Scope

### In scope

| Element | Summary |
|---|---|
| Gameplay region | ~79% width × full height, game capture positioned behind the chrome |
| Chiron | Lower third, 1920×135, vertical roll, 4 stat groups per turn |
| Match-info rail | Right 21%: facecam, 12-player split-flap board, net-worth bar, session strip |
| Facecam | 4:3 at full rail width, top of rail, optional |
| Logo bay | Dedicated 3D well at the chiron's left end |
| Stat registry | ~35 stats across four availability tiers, selected by salience |
| State machine | `IDLE → QUEUE → MATCH → RECAP`, fully automatic |
| Caching proxy | Single Node process, one `/state` route |

### Explicitly out of scope

Each of these was considered and rejected for a stated reason; see §12.

- Live in-match telemetry via demo-broadcast parsing
- Any control panel, WebSocket transport, or chat-command surface
- Multi-tenancy, accounts, hosted deployment
- A frontend framework or build step
- Per-player low-priority / behaviour flags (not available — §3.6)

---

## 3. Research findings

These were established by direct inspection of the live API and font binaries, not from
documentation. They are recorded because several of them invalidate obvious-looking approaches,
and rediscovering them is expensive.

### 3.1 API surface

- Base: `https://api.deadlock-api.com`, OpenAPI at `/openapi.json`, **126 paths**.
- **CORS is fully open**: `access-control-allow-origin: *`, `access-control-expose-headers: *`.
  The browser *could* call the API directly. CORS is therefore **not** a reason to run a proxy.
- Responses carry `Cache-Control: public, max-age=120, stale-while-revalidate=120` — the API's
  own view of data granularity, and a useful default for our cache TTLs.

### 3.2 Design tokens are first-party and fetchable

- `/v1/assets/colors` — **184 named colours**, extracted from Valve's own
  `citadel_base_styles.css` Panorama declarations. Not a fan recreation.
- `/v1/assets/fonts` — font tree on `assets-bucket.deadlock-api.com`, also `ACAO: *`.

Key tokens:

| Token | Hex | Role |
|---|---|---|
| `team1_color` | `#D4860B` | Amber team |
| `team2_color` | `#4D75C3` | Sapphire team |
| `base_text` | `#FFEFD7` | Warm off-white body text |
| `color_gold` | `#FFED79` | Souls / emphasis |
| `weapon_color` | `#E58A00` | Weapon stat |
| `spirit_color` | `#8A55B3` | Spirit stat |
| `armor_color` | `#00FF99` | Vitality stat |
| `color_enemy` | `#FF410D` | Enemy / danger |

**Two team palettes exist and disagree.** `/v1/assets/generic-data` carries `color_team1` =
`#E7B659` and `color_team2` = `#5B79E6` — noticeably brighter, likely gameplay/minimap colours
rather than UI chrome. Which to ship is an open decision (§11).

### 3.3 Fonts

| Family | Glyphs | Use |
|---|---|---|
| `Radiance` (regular/semibold/bold + italics) | 674 / 624 mapped | All text |
| `RadianceM` (regular/semibold/bold) | **12 total; 11 mapped — space + digits 0–9 only** | All numerics |
| `Reaver` (regular/semibold/bold) | display | Faction names, chiron spine |

`RadianceM` is Deadlock's dedicated tabular-numerals cut — the font the game uses for HUD
counters. Parsed from `radiancem-semibold.otf`: `unitsPerEm` 1000; digits `0`–`9` are glyph IDs
1–10 with every advance exactly **569/1000 em**. Genuinely tabular, so digits sit dead-centre in
a fixed grid.

**Gotcha:** the space glyph (gid 11) is **600/1000 em** — 5.4% wider than a digit. RadianceM
spaces therefore cannot be used for numeric alignment. This does not affect the roster board,
whose blank positions are styled cells rather than space glyphs (§5.2), but it rules out
space-padding any RadianceM string in the chiron.

**Consequence worth exploiting:** because `RadianceM` contains *only* digits, the font stack
`"RadianceM", "Radiance"` routes digits to the numeral font and letters to the UI font
automatically. No per-character font logic is needed anywhere.

### 3.4 Match detection and live roster

`/v1/matches/active` accepts `account_id` (SteamID3) and returns, per match:

- `players[]` — `account_id`, `team`, `team_parsed`, `hero_id`, `abandoned`
- `net_worth_team_0`, `net_worth_team_1`
- `objectives_mask_team0`, `objectives_mask_team1`, `mid_boss`
- `match_score`, `start_time`, `duration_s`, `spectators`, `match_mode_parsed`

Rate limit **100 req/s**. This yields near-live team net worth and objective state with **no
demo parser**.

**The limit that matters:** the endpoint is the in-game watch tab, capped at ~150–200
concurrent matches globally and sorted by **average MMR, not popularity** — measured live, 93 of
150 matches had zero spectators and the mix was 87 ranked / 63 unranked. So whether a given
match appears depends on the operator's rank, not their viewership. Every feature depending on
it must degrade gracefully (§8).

### 3.5 Per-player history

`/v1/players/{account_id}/match-history` — **100 req/s** (the documented 10 req/h applies only
to "bot friend" auth, not normal use). `PlayerMatchHistoryEntry` carries:

`match_result`, `player_match_outcome`, `start_time`, `hero_id`, `player_kills/deaths/assists`,
`net_worth`, `last_hits`, `denies`, `hero_level`, `match_duration_s`, `ranked_delta`,
`ranked_display_badge`, `abandoned_time_s`, `team_abandoned`

Everything in the "free" stat tier is derived from this single call per player.

### 3.6 Batch endpoints, and the binding rate limit

| Endpoint | Batching | IP limit |
|---|---|---|
| `/v1/players/steam?account_ids=` | yes | 100 req/s (read path) |
| `/v1/players/rank?account_ids=` | yes | **20 req/min** ← tightest |
| `/v1/players/hero-stats?account_ids=` | yes | 100 req/s |
| `/v1/players/{id}/match-history` | no | 100 req/s |
| `/v1/analytics/*` | n/a | 200 req/min, **shared across all analytics** |
| `/v1/matches/{id}/metadata` | no | generous |
| `/v1/commands/resolve` | many vars per call | 60 req/60s |

**Batch rank at 20/min is the project's rate ceiling.** Safe when fetched once per match
(the roster is immutable after start); fatal if polled. This is the single strongest reason the
cache lives in one process rather than in a browser source that may be open twice.

### 3.7 Dead ends — confirmed, do not revisit

- **`/v1/sql` is deprecated.** The description states direct SQL access will be removed; limit is
  2 req/min, 20 req/hr. The replacement is a DuckDB/DuckLake data lake at `data.deadlock-api.com`,
  far too heavy for an overlay. **Do not build on SQL.**
- **No per-player low-priority or behaviour data exists.** `is_low_pri_pool` appears only as a
  *filter on matches* in analytics endpoints; `match_player.low_pri_pool` is a match-level column
  reachable only via deprecated SQL or ~240 per-match `metadata` calls to cover 12 players'
  recent history. A scan of all 126 endpoints and every component schema found no `behaviour`,
  `trust`, `conduct`, `report`, or `priority` field on a player. Statlocker sources this elsewhere.
- **Live telemetry costs more than it returns.** `/v1/matches/{match_id}/live/url` is **6 req/h
  per IP**, hands back a demofile broadcast URL requiring a C# (`demofile-net`) or Rust (`haste`)
  parser — not browser-reachable — and the demo takes ~30s to become available. Since OBS
  composites the overlay over *live* capture, a demo-derived scoreboard would trail the action
  viewers just watched by half a minute, while duplicating data the game's own HUD already shows.

### 3.8 Twitch overlay convention

The standard is a web page loaded as an OBS **Browser Source** at 1920×1080 with a transparent
background, layered over game capture. No plugin, no Twitch Extension, no Twitch API. Source
order in OBS determines z-order.

---

## 4. Visual system

### 4.1 Layout — broadcast windowbox

```
┌────────────────────────────────────────────┬──────────────┐
│                                            │  FACECAM 4:3 │
│                                            ├──────────────┤
│         GAMEPLAY  ~79% × full height       │  MATCH INFO  │
│         (game capture behind chrome)       │  12 rows     │
│                                            │  split-flap  │
│                                            ├──────────────┤
│                                            │  NET WORTH   │
│                                            ├──────────────┤
│                                            │  SESSION     │
├──────┬─────────────────────────────────────┴──────────────┤
│ LOGO │  CHIRON — spine + 4 stat groups + rank chip        │
└──────┴────────────────────────────────────────────────────┘
```

No top bar. The wordmark header from the first draft was dropped in favour of the logo bay,
which returns ~56px of vertical game pixels.

**Dimensions at 1920×1080:**

| Region | Size |
|---|---|
| Rail | 21% = 403px wide |
| Chiron | 12.5% = 135px tall |
| Logo bay | 11% of chiron width = 211px |
| Gameplay | ~1517 × 945px |
| Facecam | 403 × 302px (4:3) |

**Rail vertical budget:** 945 available − 302 facecam − 62 header/bands − 360 (12 rows × 30px)
= **221px slack**, occupied by the net-worth bar and session strip.

### 4.2 Factions

**Amber = Hidden King. Sapphire = Archmother.** (Operator-confirmed.)

The API exposes no faction names anywhere — only colour tokens and a `Team0`/`Team1` enum. The
names are a two-entry constant in our config.

**Mapping is bound to colour, not to team index.** Valve's CSS names tokens `team1_color` /
`team2_color` (1-indexed) while the API returns `Team0` / `Team1` and `net_worth_team_0`
(0-indexed). Standard Valve convention makes `team1_color` the first team, i.e. `Team0` = Amber
= Hidden King — but this is convention, not documentation. Binding faction to colour keeps a
surprise to a one-line fix rather than a mislabelled broadcast. **Verify against one real match
on day one.**

### 4.3 Typography

| Role | Face | Size |
|---|---|---|
| Faction names, chiron spine | Reaver Bold | 8–15px |
| Body, labels, player names | Radiance Semibold | 7–11px |
| All numerics | RadianceM Semibold | 9–23px |
| Split-flap cells | `"RadianceM", "Radiance"` stack | 12px |

Fonts are **vendored into the repo**, not loaded from Valve's CDN. The CDN is CORS-open and
works, but a broadcast should not depend on a third-party bucket being up.

### 4.4 Tokens

Generated once by `npm run tokens`, which fetches `/v1/assets/colors` and writes `tokens.css`,
committed to the repo. Colours change per patch, not per match, so a runtime fetch buys nothing
and adds a failure mode.

```css
--flap-seam:     1.2px;    /* absolute px — see §5.2 */
--flap-seam-op:  0.34;
--flap-cell:     15px × 20px;
--flap-type:     12px;
--flap-cells:    10;       /* value cells, constant */
--flap-head:     8;        /* header cells, constant */
--hidden-king:   #D4860B;
--archmother:    #4D75C3;
--base-text:     #FFEFD7;
--souls:         #FFED79;
--chiron-hold:   9s;
--chiron-groups: 4;
```

---

## 5. Component: match-info rail

### 5.1 Roster board

All **12 players** — both factions, operator included. The operator is pinned **first within
their faction** (not sorted among it) with a 3px gold left rule, gold name, and a `YOU` tag.

Including the operator was a deliberate change from an earlier 11-player design. It works
cleanly because every shipping stat mode is **per-player**, not relational, so the operator's row
needs no special-case data path. More usefully, it supplies a baseline: "41% season" or "2–7
together" means little in isolation, but with the operator's own figure in the same column every
row reads as better or worse than them at a glance.

Faction bands carry the name in Reaver plus that team's net worth.

### 5.2 Split-flap mechanism

Values render as a **Solari-style split-flap board**. Each cell spins through the charset to its
target glyph; rows stagger down the board rather than flipping in unison.

**Constant cell count — a hard rule.** 10 value cells, 8 header cells, built once at mount and
never rebuilt. A physical departure board cannot grow extra flaps, and respecting that also
removes DOM churn, layout reflow, and the bug class where a longer value shifts the rail width
mid-broadcast.

**Consequence:** 10 cells is a permanent budget for every present and future stat. A value
needing 11 characters abbreviates or doesn't ship. This is the correct constraint — it is the
discipline the physical metaphor imposes.

**Right-justified.** Figures align by magnitude, the right edge becomes a clean scan column, and
blank cells pool harmlessly at the left. Blanks get a darker unlit flap face so empty positions
read as hardware rather than absence.

**Seam position is in absolute pixels, not percent or em.** This was a real bug worth recording.
At `top: 58%` of cell height, the seam held its *proportional* place as cells scaled (0.133em
below optical centre at both 12×15/9px and 15×20/12px) — but the absolute gap grew 1.20px →
1.60px, and at this scale the eye judges a 1–2px gap absolutely. The seam appeared to drop.
`calc(50% + var(--flap-seam))` with the variable in px pins it to a constant visual offset at any
cell size, and both background-gradient stops read the same variable so seam and value-step
cannot drift apart.

**Legibility measures**, all four adopted:

1. Seam at `50% + 1.2px`, opacity `0.34`, with a 1px light lip beneath so it reads as an edge
   catching light rather than a strikethrough.
2. Cells at 15×20px with 12px type. Per-character division forfeits word-shape recognition, so
   each glyph must carry itself alone and needs *more* size, not less.
3. Real Deadlock fonts via the `RadianceM`/`Radiance` stack.
4. W/L as a **filled field** — dark glyph on a green or red ground — rather than coloured text.
   A run of results then reads like a bar chart when scanning a column.

**Rejected:** collapsing single-datum stats (SEASON, ABANDONS, RANK) into one wide block flap.
It is the largest available legibility gain but violates the constant-count rule.

### 5.3 Stat modes

Auto-cycling: **LAST 10 · SEASON · ABANDONS · RANK**, extensible from the free tier (§6.2).

**Abandons are presented as a neutral count** (`4/20`), amber-tinted at 3 or more. No risk icon,
no "likely abandoner" label. The underlying field cannot distinguish a rage-quit from a dropped
connection, and a named accusation on a live broadcast asserts intent the data does not carry.
The count is a stat among stats; the viewer draws their own conclusion.

### 5.4 Net worth and session strip

Net-worth differential as an Amber-vs-Sapphire split bar with absolute figures, from
`/v1/matches/active`. Session strip: today's record, K/D, rank.

---

## 6. Component: chiron

### 6.1 Form

**Vertical roll. 9s hold. 4 stat groups per turn. Staggered entry (~70ms per group).**

Each group is a small uppercase label over a large value, optionally with a sub-line — stacked to
use the full 135px height. A full-height **spine** at the left of the body carries the turn's
theme word in Reaver.

**Horizontal marquee was rejected**, and not on taste. Measured throughput at readable speeds is
*lower* than the roll (12.6 vs 26.7 stats/min), because a crawl must move slowly enough to read
and therefore spends most of its length showing content already read or not yet arrived. The
decisive argument is that this sits in the lower third over a first-person shooter beside
Deadlock's own HUD: constant horizontal motion is a permanent low-level distraction for every
viewer for the whole broadcast, bought for no content gain. A crawl also cannot express priority,
which makes the salience model (§7) meaningless.

**The two settings compound rather than trade off.** Four groups at 9s yields 26.7 stats/min
against 14.3 for one line at 4.2s — nearly double the throughput *with* a longer hold. And the
chiron is motionless ~92% of the time, which is the figure that matters over live gameplay: it
becomes a still graphic that quietly updates.

Stacking also recovered the height. A single 15px line used roughly a third of 135px; an 8px
label over a 23px value fills it, making the value type **50% larger** than the old single line
while carrying four times the content.

**No split-flap in the chiron.** A 60-character line flapping per character is noise. Split-flap
is reserved for the rail board, where cells are short numerics and the mechanism reads as
mechanical rather than chaotic. The rank chip is plain Radiance.

### 6.2 Turn themes

Five themed turns, 9s each — a 45s cycle, ordinary television pacing. Thematic grouping (rather
than shuffling) gives each turn a headline for the spine and lets the eye learn where to look.

| Spine | Groups |
|---|---|
| **Session** | Today's record · K/D · souls per min · matches played |
| **Form** | Hero · win rate + sample · delta vs global · lane win rate |
| **Standing** | Rank + progress · percentile · regional place · rank delta trend |
| **Matchup** | Opposing hero · lifetime record · counter win rate · lane pace |
| **Records** | Current streak · season best · highest kills · milestone watch |

### 6.3 Value budget

Four groups across ~1455px of content width gives each ~**360px**. Generous for `9–3`, tight for
`vs HAZE 11–4 LIFETIME`. Values therefore get a budget analogous to the board's ten cells: a
headline value, an optional small unit, and an optional sub-line. Longer content abbreviates or
splits across two groups.

---

## 7. Stat registry and salience

All four availability tiers are in scope — approximately 35 stats.

| Tier | Source | Cost | Examples |
|---|---|---|---|
| **Free** | derived from the 12 `match-history` calls already made | **zero extra calls** | K/D, win streak, net-worth avg, last hits, denies, most-played hero, matches tracked, abandons, avg match length, rank delta trend, hero pool size, win rate by lane |
| **Session** | `/v1/commands/resolve`, 42 prebuilt variables | 1 call | wins today, win rate today, heroes played today, hours played, leaderboard place, rank progress, career highs, latest patch |
| **Context** | `/v1/analytics/*` | cheap, 200/min shared | hero WR vs global, rank percentile, counter matchup, lane soul pace, hero synergy, regional leaderboard, badge distribution |
| **Recap** | `/v1/matches/{id}/metadata` | 1 call post-match | accuracy, hero damage, MVP rank, damage mitigated, boss damage, objectives, crit rate |

The free tier is the best value in the project: `match-history` is fetched for all 12 players
anyway, and a dozen further stats fall out of the same payload for nothing.

### 7.1 Salience

Taking all 35 stats is only tractable because selection is automated. **Tier membership means
eligible to air, not always on screen.**

Each stat declares three things:

1. **How to compute** itself from the state document.
2. A **minimum sample** (`n`) below which it never airs.
3. A **salience** score — roughly, deviation from its own baseline.

The chiron airs the highest-scoring turn; the stat pop-up draws from the same registry, so there
is one content pipeline rather than two.

A fixed rotation is wrong here: it gives "9–3 today" identical weight whether the operator is on
a six-game heater or dead flat, where real broadcast leads with whatever is most unusual *now*.

**The sample floor is the important half.** "5–1 against this player" is the most tempting line
available and the least trustworthy — six games is noise. The floor is what stops the overlay
confidently narrating randomness, which is the failure that makes stat graphics embarrassing.

---

## 8. Architecture

### 8.1 Processes

```
┌─ OBS ───────────────────────┐
│  Browser Source ──poll──┐   │   GET /state every 2s (localhost)
└─────────────────────────│───┘
                 ┌────────▼────────┐
                 │   Node proxy    │  cache · rate budget · composition
                 │   GET /state    │
                 └────────┬────────┘
                          ▼  api.deadlock-api.com
       active · steam · rank · hero-stats · match-history×12 · commands
```

**The overlay is a pure render function of one JSON document.** It never calls the Deadlock API,
never orchestrates, never retries. That single constraint lets the entire visual layer be
developed against a fixture file with no network and no game running — and makes it testable.

### 8.2 Why the proxy exists

Given open CORS, the proxy must justify itself on other grounds. In order of actual weight:

1. **OBS reloads browser sources** on scene switches and restarts, more often than expected. A
   browser-only design re-fetches 12 match histories every reload; the proxy's cache survives
   independently. This is the strongest reason, and it is operational rather than architectural.
2. **Batch rank is 20 req/min per IP.** One process owning that budget is safe; a browser source
   that might be open twice is not.
3. **Composition belongs server-side** — the alternative puts retry, caching, and 15-call
   orchestration inside the render layer.
4. **An API key, if added later for higher limits, cannot live in a browser source.**

Note that CORS and payload size are *not* on this list. Payload matters only in the fallback
path, where `mate-stats` returns a `matches[]` array of every match ID (measured: 383 rows ×
~200 IDs). That array is stripped at the proxy and never reaches the browser.

### 8.3 Fetch plan

Per match, once, then cached — the roster is immutable after `start_time`:

| Call | Count |
|---|---|
| `matches/active?account_id=` | 1 (polled ~15s for detection) |
| `players/steam?account_ids=` | 1 |
| `players/rank?account_ids=` | 1 |
| `players/hero-stats?account_ids=` | 1 |
| `players/{id}/match-history` | 12 |
| `commands/resolve` | 1 |
| **Total** | **~17** |

Analytics context is cached for an hour; none of it changes mid-match.

### 8.4 Modules

| Unit | Responsibility |
|---|---|
| `proxy/deadlock.js` | API client; knows endpoints and rate limits, nothing else |
| `proxy/derive.js` | `match-history` → last-10, season record, abandons, streak, averages. **Pure.** |
| `proxy/registry.js` | stat definitions: compute, min-sample, salience. **Pure.** |
| `proxy/cache.js` | per-match and per-hour TTL stores |
| `proxy/server.js` | one route, `/state` |
| `overlay/state.js` | state machine. **Pure.** |
| `overlay/flap.js` | fixed-cell split-flap driver; no knowledge of stats |
| `overlay/board.js` | roster rail |
| `overlay/chiron.js` | spine, rolling groups, rank chip |
| `overlay/tokens.css` | generated, committed |

### 8.5 State machine

`IDLE → QUEUE → MATCH → RECAP → IDLE`

Fully automatic, driven by `matches/active` detection and `start_time`/`duration_s`. No UI, no
transport, nothing to touch mid-match. This was chosen over a control panel for a practical
reason: the operator's hands are on WASD during play, and the OBS browser source is a *separate
browser instance* from their desktop browser, so `BroadcastChannel` and `localStorage` cannot
reach it — any control surface would require a real local WebSocket server.

---

## 9. Error handling

**One rule: never render a hole.** Every failure degrades to something a viewer reads as
intentional. A spinner or empty panel on a broadcast is worse than slightly stale numbers.

| Failure | Behaviour |
|---|---|
| Upstream API down | Proxy serves last-known-good from cache |
| Match not in watch index | Board **silently swaps to season form** — the operator's most-played mates and all-season records, via `mate-stats` with `min_matches_played`. Viewer sees no gap and no "not live" label. Mode is visible in proxy logs only. |
| Net worth / objectives unavailable | Bar hides; rail reflows into the slack |
| Proxy down | Overlay freezes on last good state rather than blanking |
| Fonts unreachable | Vendored locally, so this cannot occur; fallback stack regardless |
| A stat below its sample floor | Never airs; next-highest salience takes the slot |

A real network does not caption which feed failed.

---

## 10. Testing

- **`derive.js`, `registry.js`, `state.js` are pure** → table-driven tests against **recorded API
  fixtures** saved to disk from live responses, rather than hand-written mocks. The response
  shapes are fiddly enough that hand-rolled mocks would encode our misunderstandings.
- **`flap.js` needs its spin step count made deterministic** to be testable; it is currently
  randomised. Inject the step count.
- **Visual layer** is driven from fixture JSON, so each state and failure mode can be rendered
  and inspected without the game running.
- TDD per `superpowers:test-driven-development` throughout.

---

## 11. Open decisions

None block implementation; all are leaf-level.

1. **3D logo treatment** for the chiron bay — not yet designed. Placeholder is extruded Reaver.
2. **Transitions** — parked at operator's request. Four candidates built and demonstrated: deco
   wipe (cheapest, most generic), flap cascade (most distinctive, would extend the board's
   language to the whole screen), brass iris and logo sting (both fully occlude the frame, so
   restricted to true breaks). Hard cut remains the free baseline and is correct for small
   in-state updates. Recommendation is three total, not five.
3. **Palette source** — citadel chrome pair (`#D4860B`/`#4D75C3`) vs brighter generic-data pair
   (`#E7B659`/`#5B79E6`). Leaning brighter for stream compression.
4. **Team index → colour** — verify `Team0` = Amber against one real match on day one (§4.2).

---

## 12. Rejected approaches

Recorded with reasons so they are not relitigated.

| Rejected | Reason |
|---|---|
| Live demo-broadcast parsing | 6 req/h, needs a non-JS parser process, ~30s behind the gameplay viewers are watching, duplicates the in-game HUD |
| Full-bleed float layout | Reads as a streamer overlay, not a broadcast; floating panels occlude play |
| Dynamic layout (full-bleed ↔ windowbox) | Game capture cannot rescale from inside a browser source, so chrome must animate over a fixed plate — constrains the effect badly |
| Control panel / WebSocket | Hands on WASD; separate browser instance requires a real transport for little gain |
| Chat commands | Puts broadcast control in chat; needs a Twitch IRC connection |
| React / Svelte / Vite | A framework for a page with 12 rows and no user interaction |
| Cloudflare Worker + Pages | Network hop and deploy cycle between the operator and every tweak |
| `/v1/sql` custom aggregates | Deprecated, 2 req/min |
| Per-player low-priority flag | Not present in the API in any form (§3.7) |
| Explicit "risk" flag on abandons | Asserts intent the field cannot distinguish; public accusation on a named player |
| Block flap for single-datum stats | Largest legibility gain available, but breaks the constant-count rule |
| Horizontal marquee chiron | Lower measured throughput, constant motion over gameplay, cannot express priority |
| Split-flap chiron ticker | A 60-character line flapping per character is noise |
| Runtime token/font fetch | Adds a failure mode for data that changes per patch, not per match |

---

## 13. Next step

Hand to `superpowers:writing-plans` for a phased implementation plan.

Suggested phasing, each independently verifiable:

1. Proxy skeleton + `deadlock.js` + recorded fixtures + `/state` returning a fixture
2. `derive.js` against fixtures (TDD) — the free tier
3. Overlay shell, layout regions, tokens, vendored fonts
4. `flap.js` + roster board, driven from fixture JSON
5. Chiron: spine, rolling groups, themes
6. `registry.js` + salience
7. State machine + live detection against a real match
8. Failure-mode pass against §9
9. Logo and transitions (open decisions resolved)
