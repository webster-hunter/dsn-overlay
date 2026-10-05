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

  // queueing up or backing out of queue is the most frequent boundary in the
  // cycle and is not match end — hard cut, per spec §6.5's "frequent" rule
  if (prev.phase === 'IDLE' && next.phase === 'QUEUE') return null;
  if (prev.phase === 'QUEUE' && next.phase === 'IDLE') return null;

  if (next.phase === 'RECAP' || next.phase === 'IDLE' || next.phase === 'QUEUE') return 'ident';
  return null;
}

/** Resolves on the first `animationend`/`animationcancel` for `name` on `el`. */
function waitAnim(el, name) {
  return new Promise(resolve => {
    const done = e => {
      if (e.animationName !== name) return;
      el.removeEventListener('animationend', done);
      el.removeEventListener('animationcancel', done);
      resolve();
    };
    el.addEventListener('animationend', done);
    el.addEventListener('animationcancel', done);
  });
}

let els = null;

export function mountMachine(refs) { els = refs; }

/**
 * Fires the chosen transition. Resolves when the screen is usable again.
 * Resolution rides each animation's own end event rather than a timer sized
 * to --xition-sweep/--xition-ident, so it can never desync from those tokens.
 */
export function runTransition(kind, mark) {
  if (kind === 'sweep') {
    sweepLogo(mark);
    return mark ? waitAnim(mark, 'mark-sweep') : Promise.resolve();
  }
  if (kind === 'ident' && els) {
    els.veil.classList.add('run');
    els.ident.classList.add('run');
    return waitAnim(els.ident, 'ident-fade').then(() => {
      els.veil.classList.remove('run');
      els.ident.classList.remove('run');
    });
  }
  return Promise.resolve();
}
