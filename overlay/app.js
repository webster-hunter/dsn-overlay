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
