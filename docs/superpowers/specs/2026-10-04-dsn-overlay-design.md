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
| Chiron | Lower third, 1920×135, vertical roll, 4 stat groups per turn, 9s hold |
| Match-info rail | Right 21%: facecam, then a 12-player split-flap board |
| Facecam | 16:9 at full rail width, top of rail, optional |
| Logo bay | 211×135 noir well at the chiron's left end, carrying Valve's layered logo in bone |
| Transitions | Logo sweep for live boundaries, eye ident for match end, hard cut otherwise |
| Stat registry | ~35 stats across four availability tiers, selected by salience |
| State machine | `IDLE → QUEUE → MATCH → RECAP`, fully automatic |
| Caching proxy | Single Node process, one `/state` route |

### Explicitly out of scope

Each of these was considered and rejected for a stated reason; see §12.

- Live in-match telemetry via demo-broadcast parsing
- Any control panel, WebSocket transport, or chat-command surface
- Multi-tenancy, accounts, hosted deployment
- A frontend framework or build step
- Per-player low-priority / behaviour flags (not available — §3.7)
- A net-worth widget or session strip in the rail (both duplicate other surfaces — §5.5)

---

## 3. Research findings

Established by direct inspection of the live API and font binaries, not from documentation.
Recorded because several of them invalidate obvious-looking approaches.

### 3.1 API surface

- Base: `https://api.deadlock-api.com`, OpenAPI at `/openapi.json`, **126 paths**.
- **CORS is fully open**: `access-control-allow-origin: *`, `access-control-expose-headers: *`.
  The browser *could* call the API directly. CORS is therefore **not** a reason to run a proxy.
- Responses carry `Cache-Control: public, max-age=120, stale-while-revalidate=120` — the API's
  own view of data granularity, and a sensible default for our cache TTLs.

### 3.2 Design tokens are first-party and fetchable

- `/v1/assets/colors` — **184 named colours** extracted from Valve's own
  `citadel_base_styles.css` Panorama declarations. Not a fan recreation.
- `/v1/assets/fonts` — font tree on `assets-bucket.deadlock-api.com`, also `ACAO: *`.

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
rather than UI chrome. Which to ship is open (§11).

### 3.3 Fonts

| Family | Glyphs | Use |
|---|---|---|
| `Radiance` (regular/semibold/bold + italics) | 674 total, 624 mapped | All text |
| `RadianceM` (regular/semibold/bold) | **12 total, 11 mapped — space + digits 0–9 only** | All numerics |
| `Reaver` (regular/semibold/bold) | display | Faction names, chiron spine |

`RadianceM` is Deadlock's dedicated tabular-numerals cut — the font the game uses for HUD
counters. Parsed from `radiancem-semibold.otf`: `unitsPerEm` 1000; digits `0`–`9` are glyph IDs
1–10 with every advance exactly **569/1000 em**. Genuinely tabular, so digits sit dead-centre in
a fixed grid.

**Consequence worth exploiting:** because `RadianceM` contains *only* digits, the font stack
`"RadianceM", "Radiance"` routes digits to the numeral font and letters to the UI font
automatically. No per-character font logic is needed anywhere.

**Gotcha:** the space glyph (gid 11) is **600/1000 em** — 5.4% wider than a digit. RadianceM
spaces therefore cannot be used for numeric alignment. Harmless for the roster board, whose blank
positions are styled cells rather than space glyphs (§5.3), but it rules out space-padding any
RadianceM string in the chiron.

### 3.4 Rank tiers

From `/v1/assets/ranks` — **12 tiers, subranks 1–6** (always a single digit):

| Tier | Name | Chars + subrank |
|---|---|---|
| 0 | Obscurus | 10 |
| 1 | Initiate | 10 |
| 2 | Seeker | 8 |
| 3 | Acolyte | 9 |
| 4 | Sentinel | 10 |
| 5 | Mystic | 8 |
| 6 | **Ritualist** | **11** |
| 7 | Emissary | 10 |
| 8 | Oracle | 8 |
| 9 | Phantom | 9 |
| 10 | **Ascendant** | **11** |
| 11 | Eternus | 9 |

**Archon, Alchemist and Arcanist are no longer Deadlock ranks** — they appear in older material
and were used mistakenly in early mockups for this project. Do not reintroduce them.

`Ritualist 6` and `Ascendant 6` are **11 characters**, which sets the board's cell count (§5.3).

Each tier also carries its own `color` (Ascendant `#C39751`, Eternus `#E0C060`, …), used to tint
the RANK column per tier.

### 3.5 Match detection and live roster

`/v1/matches/active` accepts `account_id` (SteamID3) and returns, per match:

- `players[]` — `account_id`, `team`, `team_parsed`, `hero_id`, `abandoned`
- `net_worth_team_0`, `net_worth_team_1`
- `objectives_mask_team0`, `objectives_mask_team1`, `mid_boss`
- `match_score`, `start_time`, `duration_s`, `spectators`, `match_mode_parsed`

Rate limit **100 req/s**. This yields the roster and near-live team state with **no demo parser**.
Only the roster is consumed; see §5.5 for why net worth is not rendered.

**The limit that matters:** the endpoint is the in-game watch tab, capped at ~150–200 concurrent
matches globally and sorted by **average MMR, not popularity** — measured live, 93 of 150 matches
had zero spectators and the mix was 87 ranked / 63 unranked. So whether a given match appears
depends on the operator's rank, not their viewership. Every dependent feature must degrade
gracefully (§9).

### 3.6 Per-player history and batch endpoints

`/v1/players/{account_id}/match-history` — **100 req/s** (the documented 10 req/h applies only to
"bot friend" auth). `PlayerMatchHistoryEntry` carries `match_result`, `player_match_outcome`,
`start_time`, `hero_id`, `player_kills/deaths/assists`, `net_worth`, `last_hits`, `denies`,
`hero_level`, `match_duration_s`, `ranked_delta`, `ranked_display_badge`, `abandoned_time_s`,
`team_abandoned`. The entire "free" stat tier derives from this one call per player.

| Endpoint | Batching | IP limit |
|---|---|---|
| `/v1/players/steam?account_ids=` | yes | 100 req/s (read path) |
| `/v1/players/rank?account_ids=` | yes | **20 req/min** ← tightest |
| `/v1/players/hero-stats?account_ids=` | yes | 100 req/s |
| `/v1/players/{id}/match-history` | no | 100 req/s |
| `/v1/analytics/*` | n/a | 200 req/min, **shared across all analytics** |
| `/v1/matches/{id}/metadata` | no | generous |
| `/v1/commands/resolve` | many vars per call | 60 req/60s |

**Batch rank at 20/min is the project's rate ceiling.** Safe fetched once per match (the roster is
immutable after start); fatal if polled. This is the strongest reason the cache lives in one
process rather than a browser source that may be open twice.

### 3.7 Dead ends — confirmed, do not revisit

- **`/v1/sql` is deprecated.** The description states direct SQL access will be removed; limit is
  2 req/min, 20 req/hr. The replacement is a DuckDB/DuckLake data lake at `data.deadlock-api.com`,
  far too heavy for an overlay. **Do not build on SQL.**
- **No per-player low-priority or behaviour data exists.** `is_low_pri_pool` appears only as a
  *filter on matches* in analytics endpoints; `match_player.low_pri_pool` is a match-level column
  reachable only via deprecated SQL or ~240 per-match `metadata` calls to cover 12 players'
  recent history. A scan of all 126 paths and every component schema found no `behaviour`,
  `trust`, `conduct`, `report`, or `priority` field on a player.
- **Live telemetry costs more than it returns.** `/v1/matches/{match_id}/live/url` is **6 req/h
  per IP**, hands back a demofile broadcast URL requiring a C# (`demofile-net`) or Rust (`haste`)
  parser — not browser-reachable — and the demo takes ~30s to become available. Since OBS
  composites the overlay over *live* capture, a demo-derived scoreboard would trail the action
  viewers just watched by half a minute, while duplicating the game's own HUD.

### 3.8 The logo is a first-party layered SVG

`/v1/assets/images` exposes Valve's own logo files under `main_menu/`, as **vector, in separate
layers**:

| File | Paths | Role |
|---|---|---|
| `deadlock_logo_outer.svg` | 4 | Outer ring |
| `deadlock_logo_inner_noeye.svg` | 9 | Inner form, eye removed |
| `deadlock_logo_eye.svg` | 1 | The eye alone |
| `deadlock_logo_inner.svg` | 10 | Inner form *with* eye — unused; we composite instead |

Base URL `https://assets-bucket.deadlock-api.com/assets-api-res/images/main_menu/`, verified
`200` with `access-control-allow-origin: *` on each. All are `viewBox="0 0 100 100"`, every path
is `fill="white"`, and there are **no groups, clip paths or strokes** — so each layer recolours
with a single `currentColor` and animates independently.

This supersedes an earlier plan to draw a custom mark, and it is better on every axis: vector
rather than raster (exact at 211px and at 16px, ~15KB total), layered, first-party, stable, and
the file the game itself ships rather than a re-trace. **The separated eye layer is what makes
the transitions nearly free** (§6.5).

### 3.9 Twitch overlay convention

The standard is a web page loaded as an OBS **Browser Source** at 1920×1080 with a transparent
background, layered over game capture. No plugin, no Twitch Extension, no Twitch API. Source
order in OBS determines z-order.

---

## 4. Visual system

### 4.1 Layout — broadcast windowbox

```
┌────────────────────────────────────────────┬──────────────┐
│                                            │ FACECAM 16:9 │
│                                            ├──────────────┤
│                                            │  Match info  │
│         GAMEPLAY  ~79% × full height       │        FORM  │
│         (game capture behind chrome)       ├──────────────┤
│                                            │ Hidden King  │
│                                            │  6 rows      │
│                                            │ Archmother   │
│                                            │  6 rows      │
├──────┬─────────────────────────────────────┴──────────────┤
│ LOGO │  CHIRON — spine + 4 stat groups + persistent zone  │
└──────┴────────────────────────────────────────────────────┘
```

No top bar. The wordmark header from the first draft was dropped in favour of the logo bay,
returning ~56px of vertical game pixels.

| Region | Size |
|---|---|
| Top bar | 45px tall, full width |
| Rail | 320px wide |
| Chiron | 12.5% = 135px tall |
| Logo bay | 11% of chiron width = 211px |
| Gameplay | 1600 × 900px — **exactly 16:9** |
| Facecam | 320 × 180px (16:9) |

**Revised after first use.** The original budget gave the gameplay 1517 × 945,
which is 1.605 — not 16:9. A 16:9 game capture fitted to it left 92px of dead
space. The layout is now solved from the gameplay outwards: 1920 − 320 = 1600
wide, 1080 − 45 − 135 = 900 tall, which is 16:9 with no rounding, and the
facecam is 16:9 at the new rail width too. The rail lost 83px, so Steam names
truncate sooner; that was accepted deliberately in exchange for the game
filling its area.

**Rail vertical budget** — this arithmetic is load-bearing and an earlier draft got it wrong by
underestimating the header and bands at 62px:

| Item | px |
|---|---|
| Rail height (1080 − 45 top bar − 135 chiron) | 900 |
| Facecam 16:9 | − 180 |
| Board header (padding + eyebrow + header flaps + border) | − 54 |
| Two faction bands | − 44 |
| **Available for rows** | **622** |
| 12 rows × 48px | − 576 |
| **Slack** | **+46** |

**The facecam is 16:9 because of this budget.** At 4:3 (302px) only 545px remains, and 12 rows at
48px need 576 — a 31px overflow. 16:9 is also what modern webcams actually output; 4:3 was an
arbitrary early choice. If a 4:3 cam is ever required, rows must drop to 45px.

### 4.2 Factions

**Amber = Hidden King. Sapphire = Archmother.** (Operator-confirmed.)

The API exposes no faction names anywhere — only colour tokens and a `Team0`/`Team1` enum. The
names are a two-entry constant in our config.

**Mapping is bound to colour, not to team index.** Valve's CSS names tokens `team1_color` /
`team2_color` (1-indexed) while the API returns `Team0` / `Team1` and `net_worth_team_0`
(0-indexed). Standard Valve convention makes `team1_color` the first team, i.e. `Team0` = Amber
= Hidden King — but that is convention, not documentation. Binding faction to colour keeps a
surprise to a one-line fix rather than a mislabelled broadcast. **Verify against one real match
on day one.**

### 4.3 Typography

| Role | Face | Size |
|---|---|---|
| Faction names, chiron spine | Reaver Bold | 9–15px |
| Player names | Radiance Semibold | **14px, auto-fit to 8px** |
| Hero sub-line | Radiance Semibold | 9px |
| Labels, eyebrows | Radiance Semibold | 7–9px |
| All numerics | RadianceM Semibold | 9–23px |
| Split-flap cells | `"RadianceM", "Radiance"` stack | 12px |

Fonts are **vendored into the repo**, not loaded from Valve's CDN. The CDN is CORS-open and
works, but a broadcast should not depend on a third-party bucket.

### 4.4 Tokens

Generated once by `npm run tokens`, which fetches `/v1/assets/colors` and writes `tokens.css`,
committed to the repo. Colours change per patch, not per match, so a runtime fetch buys nothing
and adds a failure mode.

```css
--flap-seam:      1.2px;   /* absolute px — see §5.3 */
--flap-seam-op:   0.34;
--flap-cell:      15px × 20px;
--flap-type:      12px;
--flap-cells:     11;      /* value cells, constant */
--flap-head:      8;       /* header cells, constant */
--row-height:     48px;
--name-size:      14px;    /* auto-fit floor 8px */
--facecam-ratio:  16 / 9;
--hidden-king:    #D4860B;
--archmother:     #4D75C3;
--base-text:      #FFEFD7;
--souls:          #FFED79;
--chiron-hold:    9s;
--chiron-groups:  4;
--mark-color:     #FFEFD7;  /* bone — see §6.4 */
--mark-rev:       90s;      /* 4°/s, below perception */
--mark-blink:     10s;
--xition-sweep:   1.1s;
--xition-ident:   1.9s;
```

---

## 5. Component: match-info rail

### 5.1 Roster board

All **12 players** — both factions, operator included. The operator is pinned **first within
their faction** (not sorted among it) with a 3px gold left rule, gold name, and a `YOU` tag.

Including the operator works cleanly because every shipping stat mode is **per-player**, not
relational, so the operator's row needs no special-case data path. More usefully it supplies a
baseline: "41% season" means little in isolation, but with the operator's own figure in the same
column every row reads as better or worse than them at a glance.

Faction bands carry the name in Reaver plus that team's net worth figure.

**Header block.** A small `Match info` eyebrow sits directly above the stat-name flaps, **both
right-aligned** so they read as a stacked pair. The stat name is the column header for the value
cells beneath, so it must share their right edge — left-aligning the pair would drag all twelve
rows of data left with it and forfeit the right-hand scan column.

### 5.2 Player names

Steam allows 32 characters with no script restriction. Measured with `canvas.measureText` against
the real Radiance face, against a **169px** name column (403 − 18 padding − 24 avatar − 16 gaps −
176 cells):

- 32 narrow or mixed-case Latin characters **fit** at 14px. The common worst case is not a problem.
- **All-caps wide Latin** and **CJK** do not — every CJK glyph is full-width, so 32 characters is
  ~32em and overflows any affordable column. Emoji behave the same way. Cyrillic sits between.

**Auto-fit** handles the middle of the distribution: measure each name, step the font down toward
**8px** until it fits, ellipsis only past that. Most names keep large type, awkward ones shrink,
pathological ones clip. Truncation is unavoidable for part of the distribution; the goal is only
that it degrades gracefully.

A **hero sub-line** at 9px sits under each name, which the 48px row height affords.

### 5.3 Split-flap mechanism

Values render as a **Solari-style split-flap board**. Each cell spins through the charset to its
target glyph; rows stagger down the board rather than flipping in unison.

**Constant cell count — a hard rule.** **11 value cells**, 8 header cells, built once at mount and
never rebuilt. A physical departure board cannot grow extra flaps, and respecting that also
removes DOM churn, layout reflow, and the bug class where a longer value shifts the rail width
mid-broadcast.

**Why 11 and not 10.** `Ritualist 6` and `Ascendant 6` are 11 characters (§3.4). At ten cells,
right-justified, the board would render `SCENDANT 6` on stream. Eleven costs 16px of name column
and is exactly what the data requires. The rule says *constant*, not *ten*.

**Why not 12 for headroom.** A twelfth cell costs another 16px of name width today to insure
against a 10-letter tier Valve has not shipped. If one ever lands it is a one-line change.

**Consequence:** 11 cells is a permanent budget for every present and future stat. A value needing
12 characters abbreviates or doesn't ship. This is the discipline the physical metaphor imposes.

**Right-justified.** Figures align by magnitude, the right edge becomes a clean scan column, and
blank cells pool harmlessly at the left. Blanks get a darker unlit flap face so empty positions
read as hardware rather than absence.

**Seam position is in absolute pixels, not percent or em.** A real bug worth recording. At
`top: 58%` of cell height the seam held its *proportional* place as cells scaled (0.133em below
optical centre at both 12×15/9px and 15×20/12px) — but the absolute gap grew 1.20px → 1.60px, and
at this scale the eye judges a 1–2px gap absolutely, so the seam appeared to drop.
`calc(50% + var(--flap-seam))` with the variable in px pins it to a constant visual offset at any
cell size, and both background-gradient stops read the same variable so seam and value-step cannot
drift apart.

**Legibility measures**, all four adopted:

1. Seam at `50% + 1.2px`, opacity `0.34`, with a 1px light lip beneath so it reads as an edge
   catching light rather than a strikethrough.
2. Cells at 15×20px with 12px type. Per-character division forfeits word-shape recognition, so
   each glyph must carry itself alone and needs *more* size, not less.
3. Real Deadlock fonts via the `RadianceM`/`Radiance` stack.
4. W/L as a **filled field** — dark glyph on a green or red ground — rather than coloured text.
   A run of results then reads like a bar chart when scanning a column.

**Cells are not enlarged beyond 15×20.** Every pixel of cell width costs 10× that in name column
(11 cells plus margins), and player names are the scarcer resource. An earlier proposal to grow
cells to 21×28 would have cut the name column from 185px to 119px.

### 5.4 Stat modes

Auto-cycling: **FORM · SEASON · ABANDONS · RANK**, extensible from the free tier (§7).

- **FORM** — the **last eleven results** as W/L filled cells, filling the board exactly with no
  blank. Named FORM after the broadcast idiom for a run of results. The chiron's turn theme of the
  same name is therefore renamed **HERO** (§6.2), so one word means one thing across the overlay.

  The sample is eleven *because* of the rename. "LAST 10" would have made an eleventh result a
  lie, which is what forced a dead cell; FORM claims no count, so the sample can be whatever fills
  the hardware — as on a real departure board, where every flap is lit. It costs nothing:
  `match-history` returns hundreds of entries, and 11 against 10 is statistically immaterial.

  This yields a coherent rule for the whole board: **text-shaped stats fill all eleven cells
  (FORM, RANK); number-shaped stats right-align with blanks to their left (SEASON, ABANDONS).**
  Blanks are then always meaningful — they signal a figure, never a gap in the data.
- **RANK** — cells tinted per tier using each tier's own `color` from `/v1/assets/ranks` (§3.4),
  so the column reads as a colour gradient down the board before any word is parsed.
- **ABANDONS** — presented as a neutral count (`4/20`), amber-tinted at 3 or more. No risk icon,
  no "likely abandoner" label. The underlying field cannot distinguish a rage-quit from a dropped
  connection, and a named accusation on a live broadcast asserts intent the data does not carry.

### 5.5 What the rail deliberately does not contain

Two widgets were designed, built, and cut as redundant.

- **Net-worth differential bar.** Deadlock displays team souls in its own HUD at the top of the
  screen. This repeated the same figures one section after this spec rejected live telemetry for
  exactly that reason.
- **Session strip** (today / K/D / rank). The chiron's Session turn already carries all three.

The one property worth preserving was *persistence* — the chiron shows Session for 9s of a 45s
cycle, so a viewer arriving mid-stream could wait 36s to see the operator's record. That argued
for moving **today's record into the chiron's persistent zone** beside the rank (§6.1), where it
is always visible at zero rail cost — not for a rail widget.

Removing both freed vertical space, which was spent on **row height** (30px → 48px) rather than
cell size, per §5.3.

---

## 6. Component: chiron, logo bay and transitions

### 6.1 Form

**Vertical roll. 9s hold. 4 stat groups per turn. Staggered entry (~70ms per group).**

Each group is a small uppercase label over a large value, optionally with a sub-line — stacked to
use the full 135px height. A full-height **spine** at the left of the body carries the turn's
theme word in Reaver. A **persistent zone** at the right carries today's record and the rank
badge with progress; neither rolls.

**Horizontal marquee was rejected**, and not on taste. Measured throughput at readable speeds is
*lower* than the roll (12.6 vs 26.7 stats/min), because a crawl must move slowly enough to read
and therefore spends most of its length showing content already read or not yet arrived. The
decisive argument is that this sits in the lower third over a first-person shooter beside
Deadlock's own HUD: constant horizontal motion is a permanent low-level distraction for every
viewer for the whole broadcast, bought for no content gain. A crawl also cannot express priority,
which makes the salience model (§7.1) meaningless.

**The two settings compound rather than trade off.** Four groups at 9s yields 26.7 stats/min
against 14.3 for one line at 4.2s — nearly double the throughput *with* a longer hold. And the
chiron is motionless ~92% of the time, the figure that matters over live gameplay: it becomes a
still graphic that quietly updates.

Stacking also recovered the height. A single 15px line used roughly a third of 135px; an 8px label
over a 23px value fills it, making the value type **50% larger** than the old single line while
carrying four times the content.

**No split-flap in the chiron.** A 60-character line flapping per character is noise. Split-flap
is reserved for the rail board, where cells are short numerics and the mechanism reads as
mechanical rather than chaotic. The rank chip is plain Radiance.

### 6.2 Turn themes

Five themed turns, 9s each — a 45s cycle, ordinary television pacing. Thematic grouping gives each
turn a headline for the spine and lets the eye learn where to look.

| Spine | Groups |
|---|---|
| **Session** | Today's record · K/D · souls per min · matches played |
| **Hero** | Hero · win rate + sample · delta vs global · lane win rate |
| **Standing** | Rank + progress · percentile · regional place · rank delta trend |
| **Matchup** | Opposing hero · lifetime record · counter win rate · lane pace |
| **Records** | Current streak · season best · highest kills · milestone watch |

This turn was called *Form* in earlier drafts and is renamed **Hero** so that FORM means only one
thing in the overlay (§5.4). Its spine sub-label already read "Hero".

### 6.3 Value budget

Four groups across ~1455px of content width gives each ~**360px**. Generous for `9–3`, tight for
`vs HAZE 11–4 LIFETIME`. Values therefore get a budget analogous to the board's cells: a headline
value, an optional small unit, and an optional sub-line. Longer content abbreviates or splits
across two groups.

### 6.4 Logo bay

A 211 × 135px well at the chiron's left end, walled off by the amber rule, with its own noir
ground: a single hard key light from upper-left, deep falloff, and a vignette.

**The mark is Valve's logo, composited from the three layers in §3.8** — `outer`,
`inner_noeye`, `eye` — stacked and recoloured to a single bone `#FFEFD7`. **Symbol only; no
wordmark.**

**Bone, not black.** Measured against the bay at three sample points:

| Mark | vs unlit `#090703` | vs mid `#15110A` | vs lit corner `#3A342B` |
|---|---|---|---|
| **bone `#FFEFD7`** | **17.81:1** | **16.64:1** | **10.89:1** |
| near-black `#090703` | 1.00:1 | 1.07:1 | 1.64:1 |
| pure black `#000000` | 1.04:1 | 1.12:1 | 1.71:1 |

3:1 is the floor for a large graphic; black does not reach 2:1 anywhere in the bay. Black would
require a light bay, and this one is noir by design.

**Ambient motion:**

- **Rotation** — the `outer` layer turns continuously, **90s per revolution = 4°/s**. Chosen
  deliberately below the ~5°/s threshold at which drift is consciously registered as motion, so
  it reads as the mark being alive rather than animated. This matters because the same objection
  that killed the horizontal marquee (§6.1) applies to a spinning logo: it is on screen for every
  second of every broadcast. At 30s (12°/s) it becomes visible drift; at 7s (51°/s) it is a
  spinner and should not ship.
- **Blink** — the `eye` layer scales to `scaleY(.06)` for ~120ms every **10s**. Intermittent
  rather than continuous, so it is in motion under **1.2% of the time** and never establishes the
  steady movement that pulls focus. Below ~4s it reads as nervous.

**One consequence worth naming:** this is Valve's mark, so a viewer reads it as *Deadlock*, not as
*DSN*. For a single-operator stream about Deadlock that is normal and expected. The DSN network
conceit is carried by the chiron's structure and spine rather than by a wordmark.

### 6.5 Transitions

Only **two** are needed, because there are only two kinds of boundary: one where gameplay is live
and must stay visible, and one where it is not. Both reuse the logo layers, so neither requires
new art.

| Boundary | Transition | Duration | Occludes |
|---|---|---|---|
| `QUEUE → MATCH` | **Logo sweep** | 1.1s | nothing |
| `MATCH → RECAP` | **Eye ident** | 1.9s | everything |
| `RECAP → IDLE/QUEUE` | **Eye ident** | 1.9s | everything |
| Chiron turn change | Vertical roll (§6.1) | 0.5s | nothing |
| Board stat change | Flap cascade (§5.3) | ~1.1s | nothing |
| Any value update | **Hard cut** | 0 | nothing |

**Logo sweep.** The `outer` ring turns 180° on an ease while the chiron's stat groups roll out and
back behind it. Nothing but the chiron moves, so it is safe over live play — which is the whole
requirement at a match start.

**Eye ident.** The mark lifts out of the bay, grows to ~4× centre-frame while turning ~200°, the
`eye` layer shuts, a near-black veil peaks for the state swap, then it reopens and recedes. Three
CSS animations on layers Valve already separated. Full occlusion is acceptable here and only here:
at match end the player is on a scoreboard or death screen, so there is no live gameplay to hide.

**Hard cut is the default** and is correct for anything frequent. A transition on a changing number
is noise.

**Rejected:** the deco wipe (the eye ident does the same job and carries the brand, and two devices
for one role is clutter) and the flap cascade as a *whole-screen* transition (it competes with the
eye ident for the match-end slot; two signatures is one too many — it remains the board's own
mechanism for stat changes).

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

Taking all 35 stats is tractable only because selection is automated. **Tier membership means
eligible to air, not always on screen.**

Each stat declares three things:

1. **How to compute** itself from the state document.
2. A **minimum sample** (`n`) below which it never airs.
3. A **salience** score — roughly, deviation from its own baseline.

The chiron airs the highest-scoring turn; the stat pop-up draws from the same registry, so there
is one content pipeline rather than two.

A fixed rotation is wrong here: it gives "9–3 today" identical weight whether the operator is on a
six-game heater or dead flat, where real broadcast leads with whatever is most unusual *now*.

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
   independently. The strongest reason, and an operational rather than architectural one.
2. **Batch rank is 20 req/min per IP.** One process owning that budget is safe; a browser source
   that might be open twice is not.
3. **Composition belongs server-side** — the alternative puts retry, caching, and orchestration
   inside the render layer.
4. **An API key, if added later for higher limits, cannot live in a browser source.**

CORS and payload size are *not* on this list. Payload matters only in the fallback path, where
`mate-stats` returns a `matches[]` array of every match ID (measured: 383 rows × ~200 IDs). That
array is stripped at the proxy and never reaches the browser.

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
| `proxy/derive.js` | `match-history` → form, season record, abandons, streak, averages. **Pure.** |
| `proxy/registry.js` | stat definitions: compute, min-sample, salience. **Pure.** |
| `proxy/cache.js` | per-match and per-hour TTL stores |
| `proxy/server.js` | one route, `/state` |
| `overlay/state.js` | state machine. **Pure.** |
| `overlay/flap.js` | fixed-cell split-flap driver; no knowledge of stats |
| `overlay/board.js` | roster rail, name auto-fit |
| `overlay/chiron.js` | spine, rolling groups, persistent zone |
| `overlay/tokens.css` | generated, committed |

### 8.5 State machine

`IDLE → QUEUE → MATCH → RECAP → IDLE`

Fully automatic, driven by `matches/active` detection and `start_time`/`duration_s`. No UI, no
transport, nothing to touch mid-match. Chosen over a control panel for a practical reason: the
operator's hands are on WASD during play, and the OBS browser source is a *separate browser
instance* from their desktop browser, so `BroadcastChannel` and `localStorage` cannot reach it —
any control surface would require a real local WebSocket server.

---

## 9. Error handling

**One rule: never render a hole.** Every failure degrades to something a viewer reads as
intentional. A spinner or empty panel on a broadcast is worse than slightly stale numbers.

| Failure | Behaviour |
|---|---|
| Upstream API down | Proxy serves last-known-good from cache |
| Match not in watch index | Board **silently swaps to season form** — the operator's most-played mates and all-season records, via `mate-stats` with `min_matches_played`. Viewer sees no gap and no "not live" label. Mode visible in proxy logs only. |
| Proxy down | Overlay freezes on last good state rather than blanking |
| A name exceeds the column | Auto-fit to 8px, then ellipsis (§5.2) |
| Fonts unreachable | Vendored locally, so this cannot occur; fallback stack regardless |
| A stat below its sample floor | Never airs; next-highest salience takes the slot |

A real network does not caption which feed failed.

---

## 10. Testing

- **`derive.js`, `registry.js`, `state.js` are pure** → table-driven tests against **recorded API
  fixtures** saved to disk from live responses, rather than hand-written mocks. The response shapes
  are fiddly enough that hand-rolled mocks would encode our misunderstandings.
- **`flap.js` needs its spin step count made deterministic** to be testable; it is currently
  randomised. Inject the step count.
- **Name auto-fit** gets a test fixture of pathological Steam names — 32 wide caps, 32 CJK, emoji,
  Cyrillic — asserting no overflow of the 169px column at any auto-fit size.
- **Visual layer** is driven from fixture JSON, so every state and failure mode can be rendered
  and inspected without the game running.
- TDD per `superpowers:test-driven-development` throughout.

---

## 11. Open decisions

One leaf decision and one day-one verification. Neither blocks implementation.

1. **Palette source** — citadel chrome pair (`#D4860B`/`#4D75C3`) vs brighter generic-data pair
   (`#E7B659`/`#5B79E6`). Leaning brighter for stream compression. Note this shrank in importance
   once the net-worth bar was cut (§5.5): team colour now appears only on the two faction bands
   and the operator's row highlight, so it is a smaller call than it was.
2. **Team index → colour** — verify `Team0` = Amber against one real match on day one (§4.2). Not
   a design decision; a fact to confirm.

Resolved since the first draft: the logo (§6.4) and the transitions (§6.5).

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
| 10 value cells | Clips `Ascendant 6` / `Ritualist 6` by one character |
| 12 value cells | Costs 16px of name column against a tier length Valve hasn't shipped |
| 21×28 cells | Would cut the name column from 185px to 119px; names are scarcer than cell size |
| Net-worth bar in the rail | Deadlock's own HUD already shows team souls |
| Session strip in the rail | Chiron's Session turn already carries it; persistence solved in the chiron instead |
| Left-aligned board header | Stat name is the column header for right-justified values; must share their right edge |
| 4:3 facecam | Leaves only 545px for rows; 12 × 48px needs 576px |
| Horizontal marquee chiron | Lower measured throughput, constant motion over gameplay, cannot express priority |
| Split-flap chiron ticker | A 60-character line flapping per character is noise |
| Runtime token/font fetch | Adds a failure mode for data that changes per patch, not per match |
| "LAST 10" as the column name | FORM is the broadcast idiom; the colliding chiron theme was renamed instead. The rename also freed the sample to be 11 and fill the board |
| A 10-result FORM sample in 11 cells | Left one permanently dead cell; nothing required the sample to be ten |
| A custom-drawn DSN mark | Four bevelled-brass and four flat-graphic directions were built and discarded. Valve ships a layered vector of the same idea (§3.8); drawing our own was work in service of nothing |
| A re-uploaded logo PNG | Raster, third-party hosting, unlayered, and potentially a re-trace. The assets API serves the real vector |
| Black mark in the bay | 1.0–1.7:1 contrast against a noir ground; below even the 3:1 floor for large graphics (§6.4) |
| DSN wordmark in the bay | Operator chose symbol-only. The network conceit is carried by the chiron's structure and spine |
| Rotation at 30s or faster | 12°/s and up reads as visible drift or outright spinning — the same permanent-distraction objection that killed the marquee |
| Deco wipe transition | The eye ident does the same job and carries the brand; two devices for one role is clutter |
| Flap cascade as a whole-screen transition | Competes with the eye ident for the match-end slot. Retained as the board's own stat-change mechanism |
| Brass iris / logo sting (early concepts) | Both superseded: the real logo *is* an eye in a ring, so the ident does this natively |

---

## 13. Next step

Hand to `superpowers:writing-plans` for a phased implementation plan.

Suggested phasing, each independently verifiable:

1. Proxy skeleton + `deadlock.js` + recorded fixtures + `/state` returning a fixture
2. `derive.js` against fixtures (TDD) — the free tier
3. Overlay shell, layout regions, tokens, vendored fonts and logo layers
4. `flap.js` + roster board + name auto-fit, driven from fixture JSON
5. Chiron: spine, rolling groups, persistent zone, themes
6. Logo bay — composite the three layers, bone, ambient rotation and blink (§6.4)
7. `registry.js` + salience
8. State machine + live detection against a real match
9. Transitions — logo sweep and eye ident, wired to state changes (§6.5)
10. Failure-mode pass against §9

Logo and transitions are no longer a trailing phase: the logo bay is static furniture needed as
soon as the chiron exists (6), and the transitions are animations on it that only become
meaningful once the state machine can fire them (9).
