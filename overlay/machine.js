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
