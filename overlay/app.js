import { mountLogo, turnLogo } from './logo.js';
import { mountChat } from './chat.js';
import { mountChiron, renderTurn } from './chiron.js';
import { mountMachine, nextTransition, runTransition } from './machine.js';

const el = id => document.getElementById(id);

// ?fixture develops the whole visual layer with no game running
const SOURCE = new URLSearchParams(location.search).has('fixture') ? '/fixture' : '/state';
const POLL_MS = 2000;

const mark = await mountLogo(el('logo-bay'));
await mountLogo(el('ident'));                    // a second mark for the ident
mountChiron({ spine: el('spine'), groups: el('groups'), persistent: el('persistent') });
mountMachine({ veil: el('veil'), ident: el('ident') });

// Assigned as text, never parsed as markup. These come from .env rather than
// the API, but the rule holds everywhere regardless of source — and the
// injection gate greps this file, so even naming the banned sink in a comment
// would fail the build.
function renderStreamer(doc) {
  el('streamer-name').textContent = doc?.streamer?.name ?? '';
  el('streamer-tagline').textContent = doc?.streamer?.tagline ?? '';
}

// Chat is static for the session: mounting it again would reload the iframe and
// wipe the scrollback, so it happens once on the first document.
let chatMounted = false;
function ensureChat(doc) {
  if (chatMounted) return;
  chatMounted = true;
  mountChat(el('chat'), doc?.streamer?.twitch ?? '');
}

let state = null;
let turn = 0;

// The ident fully covers the frame only inside its full-cover plateau: the
// mark's grow holds its peak 40–60%, the veil is opaque 34–62%, the ident
// itself is opaque 20–78% (see the ident-* keyframes in overlay.css). Swap
// the state at 40% through the token's live value, not a literal, so a
// retuned --xition-ident can never desync the swap from the cover.
const IDENT_SWAP_FRACTION = 0.4;

function cssMs(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return v.endsWith('ms') ? n : n * 1000;
}

// setInterval does not await poll(), so a slow /state fetch or a 1.9s ident
// (which blocks poll() for most of that span) could overlap a second poll
// before the first finishes — mirrors the `refreshing` guard in
// proxy/server.js, which solves the same overlapping-async-tick problem.
let polling = false;

async function poll() {
  if (polling) return;
  polling = true;
  try {
    await doPoll();
  } finally {
    polling = false;
  }
}

async function doPoll() {
  let next;
  try {
    next = await fetch(SOURCE, { cache: 'no-store' }).then(r => r.json());
  } catch (err) {
    console.warn('[app] /state fetch failed, keeping last frame', err);
    return;            // never render a hole: keep the last good document
  }

  const kind = nextTransition(state, next);
  if (kind) {
    const swap = () => {
      state = next;
      renderStreamer(state);
      ensureChat(state);
      renderTurn(state, turn);
    };
    // the ident fully covers the frame, so swap under it at the peak
    if (kind === 'ident') setTimeout(swap, cssMs('--xition-ident') * IDENT_SWAP_FRACTION); else swap();
    await runTransition(kind, mark);
  } else if (!state) {
    state = next;
    renderStreamer(state);
    ensureChat(state);
    renderTurn(state, turn);
  } else {
    state = next;
  }
}

await poll();
setInterval(poll, POLL_MS);
setInterval(() => { if (!state) return; renderTurn(state, ++turn); turnLogo(mark); }, 9000);
