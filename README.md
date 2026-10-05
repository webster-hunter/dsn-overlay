# DSN Overlay

An ESPN-styled broadcast overlay for streaming [Deadlock](https://store.steampowered.com/app/1422450/Deadlock/),
built as an OBS browser source. It reads the public Deadlock APIs and puts a
split-flap stat board and a news-ticker chiron around your gameplay.

```
┌────────────────────────────────────────────────┬──────────────┐
│                                                │   facecam    │
│                                                ├──────────────┤
│                 gameplay                       │  MATCH INFO  │
│              (transparent)                     │    FORM      │
│                                                ├──────────────┤
│                                                │ HIDDEN KING  │
│                                                │  ▸ 12 player │
│                                                │    rows with │
│                                                │  ARCHMOTHER  │
│                                                │    11 flaps  │
├──────┬─────────────────────────────────────────┴──────────────┤
│ logo │  DEADLOCK · Session   TODAY   K/D   MATCHES   RANK     │
└──────┴────────────────────────────────────────────────────────┘
  1920 × 1080 — rail 403px, chiron 135px
```

**Four regions.** Gameplay shows through a fully transparent area. The right
rail carries an optional facecam above a Solari split-flap board listing all
12 players, cycling through four stats every 9 seconds. The chiron along the
bottom rolls through five themed turns. A layered Deadlock mark sits in the
chiron's left bay and turns one notch on each chiron turn.

**Two transitions.** A logo *sweep* (1.1s) marks a match starting — it occludes
nothing, so it is safe over live play. An *ident* (1.9s) covers the frame at
match end, when you are on a scoreboard anyway.

---

## Requirements

| | |
|---|---|
| **Node.js** | 20 or newer (developed on 24) |
| **OBS Studio** | **31.0 or newer** — its embedded Chromium 127 is required for `color-mix()` and `:has()`. Older OBS renders the faction colour bands *invisible, with no error.* |
| **Dependencies** | None. Zero runtime dependencies, no build step, no bundler. |

---

## Setup

### 1. Get the code running

```bash
npm test          # 104 tests, no install step needed
npm run serve     # starts the proxy on http://localhost:7331
```

There is no `npm install` — the project has no dependencies.

### 2. Set your account id

Copy the example file and fill in your id:

```bash
cp .env.example .env
```

```ini
# .env
DSN_ACCOUNT_ID=123456789
```

`DSN_ACCOUNT_ID` is the numeric part of your SteamID3, written `[U:1:` **N** `]`
— steamid.io shows it as "steamID3". If you only have the 64-bit id:

```
account_id = steamid64 − 76561197960265728
```

`.env` is gitignored, so your id stays out of version control. It is read
relative to the repo, so it applies however you start the proxy — `npm run
serve` or `node proxy/server.js` from anywhere.

A real environment variable still wins, which is handy for a one-off:

```bash
DSN_ACCOUNT_ID=987654321 npm run serve      # bash / git bash
$env:DSN_ACCOUNT_ID = "987654321"; npm run serve   # PowerShell
```

Without an id the proxy starts, warns, and `/state` stays `IDLE` forever.
**This is deliberate, not a bug.** The upstream endpoint ignores a zero account
id and returns *every* active match, so an unconfigured proxy would happily
broadcast a stranger's game to your stream.

### 3. Start it

```bash
npm run serve
```

### 4. Add it to OBS

Add a **Browser** source:

| Setting | Value |
|---|---|
| URL | `http://localhost:7331/` |
| Width | `1920` |
| Height | `1080` |
| Custom CSS | leave OBS's default |
| Shutdown source when not visible | off |
| Refresh browser when scene becomes active | off |

Leave the browser source *above* your game capture — the gameplay region is
genuinely transparent and composites over whatever is beneath it.

---

## Usage

Start the proxy before going live and leave it running. It polls for an active
match every 15 seconds; when one is detected it fetches the roster once and the
overlay fills in within a few seconds. Nothing needs clicking.

The overlay is a pure function of one JSON document, so if it looks wrong, look
at `/state` first.

### Routes

| Route | What it is |
|---|---|
| `/` | the overlay itself — point OBS here |
| `/?fixture` | the overlay driven by committed sample data, no game required |
| `/state` | the live state document the overlay renders |
| `/fixture` | the same document built from `fixtures/` |

The server binds **loopback only** (`127.0.0.1`) and serves no CORS headers.
It is not reachable from your network.

---

## Development

`?fixture` is the whole point of the development loop — it drives every visual
path from committed sample data with no game running, no network, and no
account id:

```bash
npm run serve
# then open http://localhost:7331/?fixture
```

Because the fixture names one of its own players as the operator, the fixture
path also exercises the "you" row highlight, the `YOU` tag and the salience
ranking, which would otherwise be dead without a configured account.

### Tests

```bash
npm test
```

104 tests across 16 files, run by `node --test`. The quoted glob in the script
is required — a bare directory argument is broken on Node 24 for Windows.

Two suites are worth knowing about:

- `tests/injection.test.js` enumerates `overlay/*.js` and fails if any file
  gains an `innerHTML`, `insertAdjacentHTML`, `document.write`, `outerHTML =`,
  `eval` or `new Function` sink. It covers new files automatically. Steam
  persona names are attacker-controlled by every player in a match, so every
  API-sourced string reaches the DOM through `textContent`. The single
  permitted exception is `overlay/logo.js`, which injects three locally
  vendored SVGs and has its own scoped test.
- `tests/http.test.js` drives real requests against the server on an ephemeral
  port and asserts the process *survives* malformed input, not merely that it
  returns a 4xx.

### Regenerating vendored assets

The fonts, logo SVGs and colour tokens are committed, so you never need these
unless upstream changes:

```bash
npm run tokens     # regenerates overlay/tokens.css from /v1/assets/colors
npm run vendor     # re-downloads fonts and the three logo layers
npm run fixtures   # re-records fixtures/ from live API responses
```

`npm run fixtures` projects the Steam response down to the four fields the
overlay actually reads. The live endpoint also returns `realname`,
`countrycode` and a `friends` array of ~1,000 third parties who were never in
your match — none of which this project commits.

---

## How it works

```
Deadlock APIs ──► proxy (Node, localhost:7331) ──► /state ──► overlay (browser)
                  polls every 15s                  polled      pure render
                  caches per match                 every 2s    of one document
```

The proxy is the only thing that talks to the Deadlock API; the overlay never
does. Match history for 12 players is roughly 18 MB, so it is fetched **once
per match** at concurrency 3 and reduced to small derived stats before it ever
reaches the browser.

The state document always has the same shape, whatever happens upstream. Every
failure degrades to last-known-good or to dashes — the overlay should never
show a spinner, an error, or an empty region on a live broadcast.

### Layout

| Directory | |
|---|---|
| `proxy/` | the Node caching proxy; `server.js` is the entry point |
| `overlay/` | the browser overlay — plain HTML, CSS and ES modules |
| `fixtures/` | recorded API samples that drive `?fixture` |
| `scripts/` | one-shot generators for tokens, vendored assets and fixtures |
| `tests/` | `node --test` suites |
| `docs/superpowers/` | the design spec and implementation plan |

### Configuration

Environment:

| Variable | Default | |
|---|---|---|
| `DSN_ACCOUNT_ID` | `0` | your SteamID3 numeric part; required for live data. Set in `.env` (see `.env.example`) or the environment, which takes precedence. |
| `PORT` | `7331` | |

Tunables live in `proxy/config.js` — poll interval, cache TTLs, history
concurrency, and the faction names. Visual tokens (colours, type, timings) live
in `overlay/tokens.css`; durations referenced by JavaScript are read from those
tokens rather than duplicated as literals.

---

## Known limitations

- **`TEAM0_IS_AMBER` is an unverified assumption.** `proxy/config.js` maps team
  0 to amber / Hidden King. Confirm it against one real match before trusting
  the faction labels — if it is backwards, both team names are swapped.
- **The Session chiron turn renders dashes.** Session-tier stats need
  `/v1/commands/resolve`, which is implemented and tested but not yet wired.
  The other four turns are fully populated.
- **Stale data is unbounded.** If the proxy loses the API mid-match it keeps
  serving the last good document indefinitely rather than blanking the board.
  Nothing on screen marks the data as stale; `stale` and `reason` are present
  on the document but unrendered.
- **No coverage of `overlay/chiron.js`.** Its rendering is exercised manually
  and by the injection gate, not by unit tests.

---

## Design notes

The spec and the implementation plan live in `docs/superpowers/`. Two decisions
there are load-bearing and easy to undo by accident:

- **Flap cells are a constant 11 wide**, right-justified, truncating from the
  left. Stats never change the board's width.
- **The cell font stack is `"RadianceM", "Radiance", ui-monospace, monospace`
  and every entry matters.** `RadianceM` is a digits-only subset with exact
  tabular advances — that is what makes the columns line up — and it has *no
  letter glyphs*, so `Radiance` supplies them. Dropping either renders rank
  names in serif.
