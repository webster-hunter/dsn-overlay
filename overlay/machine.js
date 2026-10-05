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

  // Full occlusion belongs to match end: leaving MATCH or RECAP always gets
  // the ident, regardless of what phase comes next — that's the boundary
  // the spec reserves full cover for. Everything else (e.g. IDLE<->QUEUE,
  // the most frequent boundary in the whole cycle) falls out as a hard cut,
  // per spec §6.5's "frequent is the default" rule, with no pair-by-pair
  // special-casing needed.
  if (prev.phase === 'MATCH' || prev.phase === 'RECAP') return 'ident';
  return null;
}

/**
 * Resolves on the first `animationend`/`animationcancel` for `name` on `el`,
 * or after `capMs` if neither ever arrives.
 *
 * The cap is the important half. app.js holds its `polling` guard across the
 * transition this promise gates, so one lost animationend stopped polling for
 * the rest of the broadcast — a frozen overlay, no log, no recovery. OBS can
 * cause exactly that by throttling a source it considers hidden.
 *
 * It resolves rather than rejects: the contract is "the screen is usable
 * again", and the ident's cleanup rides the same .then() either way. 5s clears
 * the longest transition (--xition-ident, 1.9s) several times over, so it can
 * only fire when something has genuinely gone wrong.
 */
function waitAnim(el, name, capMs = 5000) {
  return new Promise(resolve => {
    let timer;
    const finish = () => {
      clearTimeout(timer);
      el.removeEventListener('animationend', done);
      el.removeEventListener('animationcancel', done);
      resolve();
    };
    const done = e => { if (e.animationName === name) finish(); };
    timer = setTimeout(() => {
      console.warn(`[machine] ${name} never ended; continuing so polling resumes`);
      finish();
    }, capMs);
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
