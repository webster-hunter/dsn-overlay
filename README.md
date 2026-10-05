# DSN Overlay

An ESPN-styled broadcast overlay for streaming [Deadlock](https://store.steampowered.com/app/1422450/Deadlock/),
built as an OBS browser source. It reads the public Deadlock APIs and puts a
news-ticker chiron and read-only Twitch chat around your gameplay.

```
┌──────────────────────────────────────────────────────────────┐
│ YOUR NAME   twitch.tv/you · live weeknights          45px    │
├───────────────────────────────────────────┬──────────────────┤
│                                           │     facecam      │
│                                           ├──────────────────┤
│                                           │ HOST you         │
│            gameplay 1600 × 900            │   gl out there   │
│            (transparent, 16:9)            │ MOD someone      │
│                                           │   nice rotation  │
│                                           │ viewer  [emote]  │
│                                           │   twitch chat    │
├──────┬────────────────────────────────────┴──────────────────┤
│ logo │  DEADLOCK · Session  TODAY  K/D  MATCHES  RANK        │
└──────┴──────────────────────────────────────────────────────-┘
  1920 × 1080 — top bar 45px, rail 320px, chiron 135px
```

**The gameplay area is exactly 16:9.** 1920 − 320 = 1600 wide, 1080 − 45 − 135
= 900 tall. That is deliberate: a 16:9 game capture fills it with no dead
space.

**Five regions.** A thin bar across the top carries your name and tagline.
Gameplay shows through a fully transparent area. The right rail carries an
optional facecam above **Twitch chat**, rendered in Deadlock's own type (see
*Twitch chat* below). The chiron along the bottom rolls through five themed
turns. A layered Deadlock mark sits in the chiron's left bay and turns one
notch on each chiron turn.

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
npm test          # 142 tests, no install step needed
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

# optional — shown in the bar across the top
DSN_STREAMER_NAME=Your Name
DSN_STREAMER_TAGLINE=twitch.tv/you · live weeknights
```

`DSN_ACCOUNT_ID` accepts **any** Steam identifier for your account. Steam shows
different ones on different pages, so paste whichever you have:

| What you might have | Example |
|---|---|
| Friend Code (in your Steam profile) | `900000008` |
| SteamID64 (the number in a profile URL) | `76561198083722516` |
| SteamID3 (steamid.io calls it this) | `[U:1:900000008]` |
| Legacy SteamID | `STEAM_0:0:61728394` |

They all refer to the same account and all convert to the one the Deadlock API
wants. **On startup the proxy prints the account id it resolved** — if that
line is missing, it did not understand what you pasted and will tell you so.

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

## Twitch chat

Set `DSN_TWITCH_CHANNEL` and the right rail fills with your chat, drawn by this
project rather than embedded from Twitch.

**It is read-only by construction.** The overlay connects to Twitch's IRC
gateway as an anonymous `justinfan` user — an account that cannot send, has no
credentials, and could not post even if something tried to make it. There is no
message box on screen and no token anywhere in the project.

Twitch's own embed was tried first and is wrong for a broadcast: it ships a
cookie-consent banner covering a third of the rail, an animated-emotes notice,
and a "Send a message" box nobody will type into on stream. Its popout URL
cannot be framed at all. Both were observed, not assumed.

What renders:

| | |
|---|---|
| **Emotes** | Twitch emotes from the `emotes` IRC tag, plus **BetterTTV** global and channel sets. Both CDNs are public; nothing needs an API key. |
| **Badges** | Broadcaster, moderator, VIP and subscriber appear as `HOST` / `MOD` / `VIP` / `SUB` chips in the overlay's palette. |
| **Names** | The chatter's own Twitch colour, or a warm deterministic one if they never picked a colour, so a given chatter keeps one colour all stream. |

BTTV needs the channel's numeric Twitch id, which arrives for free in the
`ROOMSTATE` tag on join — no lookup, no auth. If BTTV is down or the channel
has no BTTV account, chat still renders; emotes are a nicety and messages are
the point.

**Badge *images* are deliberately not used.** They need an authenticated Twitch
app: `badges.twitch.tv` no longer resolves and Helix returns 401 without a
registered client. Drawing the chips here avoids the auth entirely and matches
the overlay instead of importing Twitch purple.

Chat is the most attacker-controlled input in the project — more so than Steam
persona names, which at least require being in your match. Every message
reaches the DOM through `createTextNode`, and every emote `src` is a fixed CDN
base plus an id that must match `[A-Za-z0-9_-]{1,64}`, so no part of a message
can reach a URL. `tests/injection.test.js` fails the build if either property
is lost.

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

142 tests across 20 files, run by `node --test`. The quoted glob in the script
is required — a bare directory argument is broken on Node 24 for Windows.

Two suites are worth knowing about:

- `tests/injection.test.js` enumerates `overlay/*.js` and fails if any file
  gains an `innerHTML`, `insertAdjacentHTML`, `document.write`, `outerHTML =`,
  `eval` or `new Function` sink. It covers new files automatically. Steam
  persona names are attacker-controlled by every player in a match, so every
  API-sourced string reaches the DOM through `textContent`. The single
  permitted exception is `overlay/logo.js`, which injects three locally
  vendored SVGs and has its own scoped test. The same file guards the project's
  only URL sink: both emote-URL builders must validate the id, and `chat.js`
  may set `img.src` only from what `tokenise()` returned.
- `tests/http.test.js` drives real requests against the server on an ephemeral
  port and asserts the process *survives* malformed input, not merely that it
  returns a 4xx.
- `tests/tokens-drift.test.js` compares the static tokens in
  `scripts/tokens.mjs` against the committed `overlay/tokens.css`, in both
  directions. These had drifted completely apart once already: every layout
  retune edited only the CSS, so `npm run tokens` would have silently reverted
  the 16:9 gameplay area and dropped `--topbar-height` entirely, a patch later,
  with nothing failing. **If this test fails, do not regenerate to make it
  pass** — decide which file is stale first.

### Regenerating vendored assets

The fonts, logo SVGs, hero icons and colour tokens are committed, so you never
need these unless upstream changes:

```bash
npm run tokens     # regenerates overlay/tokens.css from /v1/assets/colors
npm run vendor     # re-downloads fonts, the three logo layers and 39 hero icons
```

The 39 hero icons are **currently vendored but unrendered.** They were the
split-flap board's player identity, and that board is gone. They are kept
because the chiron's Hero turn still prints `Hero 15` — a raw id, which is the
weakest text on the broadcast — and these icons are what should replace it.
`overlay/heroes/<id>.webp`, resolved by hero id with no manifest.

```bash
npm run fixtures   # re-records fixtures/ from live API responses
```

`npm run fixtures` projects the Steam response down to the two fields the
overlay actually reads — an account id and a persona name, the latter only
because the chiron names opponents. The live endpoint also returns `realname`,
`countrycode`, avatar URLs and a `friends` array of ~1,000 third parties who
were never in your match — none of which this project commits.

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
| `DSN_STREAMER_NAME` | empty | shown in the top bar |
| `DSN_STREAMER_TAGLINE` | empty | smaller line beside it — socials, schedule, anything |
| `DSN_TWITCH_CHANNEL` | empty | the channel whose chat fills the right rail, read-only. Blank leaves a placeholder card. |
| `PORT` | `7331` | |

Tunables live in `proxy/config.js` — poll interval, cache TTLs, history
concurrency, and the faction names. Visual tokens (colours, type, timings) live
in `overlay/tokens.css`; durations referenced by JavaScript are read from those
tokens rather than duplicated as literals.

---

## Upstream data freshness

Recent matches can take a while to appear, and that is upstream of this project
rather than something the proxy can fix.

`/v1/players/{id}/match-history` says so itself:

> If the account is friends with one of our bots, the match history is a
> combination of the data from **Steam** and **ClickHouse**, so you always get
> the most up-to-date data and full history. If the account is not friends with
> a bot, only the stored match history from **ClickHouse** is returned.

So an account that is **not** friended to a deadlock-api bot only ever sees
their stored copy, which lags. Observed in practice: two matches played that
morning were absent from the history hours later, `force_refetch=true` changed
nothing, and `/v1/matches/{id}/metadata` returned
`503 Failed to fetch data from Steam` for both.

Two things improve this, both external to this repo:

- **Friend one of the deadlock-api bots on Steam.** The plain endpoint this
  project already calls then returns combined Steam + ClickHouse data — no code
  change needed here. Ask in their Discord, linked as the API's own contact:
  <https://discord.gg/XMF9Xrgfqu>
- **Priority fetching requires sponsoring the API** on Patreon:
  <https://www.patreon.com/manuelhexe/membership?vanity=manuelhexe>

### Live match detection

The overlay cannot see your live match through the API. deadlock-api's only
live source is `/v1/matches/active`, which its own documentation describes as
the in-game watch tab, **"limited to the top 200 matches"** — an ordinary
account's game is never in it, and no endpoint maps a player to their current
match. Sponsoring the API does not change this: priority fetching accelerates
**finished**-match ingestion, not live detection.

Every serious Deadlock tracker solves this locally, and so does this one. The
game writes its own log when launched with `-condebug`:

> Steam → right-click **Deadlock** → Properties → **Launch Options** → `-condebug`

It then writes `game/citadel/console.log`, which carries match phase and match
id. `DSN_DEADLOCK_LOG` overrides the path if your Steam library is elsewhere.

`npm run logprobe` watches that file and reports the lines that look like match
state, so the parser can be written against what the log actually prints rather
than a guess at its format. It reads a local file and prints; nothing is sent
anywhere.

### Getting your own matches ingested

Recent matches can be missing entirely (see *Upstream data freshness*). The
fix is to submit your own match salts, which makes the API fetch the match from
Valve immediately instead of waiting for organic discovery.

Use the API authors' own tool for this — [`deadlock-api-ingest`](https://github.com/deadlock-api/deadlock-api-ingest).
Run it alongside the proxy and this overlay benefits automatically, because
every endpoint it already calls starts returning your matches.

This project deliberately does **not** implement salt recovery itself: it
requires decrypting your saved Steam session and talking to the Steam Game
Coordinator as you, which is far outside what a broadcast overlay should do.

### Data freshness on screen

The chiron's **Session** turn prints how long ago the newest match the API can
see actually started, in the `Matches` qualifier — `19h ago`, `12m ago`,
`just now`.

That one line answers the question this section raises. Finish a game, and if
it still reads `3h ago` a minute later, the match has not reached the API yet
and every history-derived number on the board is from before it — which is
exactly how you tell whether `deadlock-api-ingest` is doing its job.

It is carried even on a day with no matches, because that is when it matters
most: an empty Session turn otherwise cannot distinguish "I have not played"
from "the API has not caught up".

The document carries a timestamp and the overlay recomputes the age on every
render, rather than the proxy formatting a string once. That is what makes a
frozen document visibly age instead of sitting there looking live. A missing
timestamp and a machine whose clock runs ahead both render as nothing, never
as `NaN ago` or `-4m ago`.

### Why the polling cadence is what it is

deadlock-api's limits for bot-friended accounts on match history are **10 req/h**
plain, but only **1 req/h with `force_refetch=true`**. This project therefore
never sets `force_refetch`, and fetches the operator's own history at most:

| trigger | |
|---|---|
| idle baseline | once per `CONTEXT_TTL_MS` (60 min) |
| a match ending | immediately — the numbers just changed |
| idle safety net | every `SELF_RECHECK_MS` (15 min) at most |

Worst case is 4 fetches an hour, inside the 10/h allowance. The safety net
exists because the match-ending trigger needs the proxy to actually observe the
match, and the active-match feed is not guaranteed to report one.

---

## Known limitations

- **`TEAM0_IS_AMBER` is an unverified assumption.** `proxy/config.js` maps team
  0 to amber / Hidden King. Confirm it against one real match before trusting
  the faction labels — if it is backwards, both team names are swapped.
- **The Session chiron turn renders dashes.** Session-tier stats need
  `/v1/commands/resolve`, which is implemented and tested but not yet wired.
  The other four turns are fully populated.
- **A lost feed is not captioned.** If the proxy loses the API mid-match it
  keeps serving the last good document rather than blanking the board, and
  nothing says which feed dropped — `stale` and `reason` are on the document
  for the logs, deliberately unrendered, because a real broadcast does not
  caption its own plumbing. The *age* of the data is shown instead, which
  covers the case that matters: a board the proxy has stopped updating keeps
  ageing on screen. See *Data freshness on screen* below.
- **Recent matches may lag.** See *Upstream data freshness* above — an account
  not friended to a deadlock-api bot only gets their stored history copy.
- **No coverage of `overlay/chiron.js`.** Its rendering is exercised manually
  and by the injection gate, not by unit tests.

---

## Design notes

The spec and the implementation plan live in `docs/superpowers/`. One decision
there is load-bearing and easy to undo by accident:

- **The cell font stack is `"RadianceM", "Radiance", ui-monospace, monospace`
  and every entry matters.** `RadianceM` is a digits-only subset with exact
  tabular advances — that is what makes the columns line up — and it has *no
  letter glyphs*, so `Radiance` supplies them. Dropping either renders rank
  names in serif.
