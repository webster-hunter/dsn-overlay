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

// Per-row generation counter. A call to setFlapRow bumps it; any in-flight
// chain from a superseded call sees its own generation go stale and stops
// touching the glyph — otherwise two overlapping calls on the same row race
// on the same cell and the row settles as a permanent splice of both targets.
const gen = new WeakMap();

/** Flap the row to `text`, cascading left to right. */
export function setFlapRow(row, text, tint, baseDelay = 0) {
  const g = (gen.get(row) ?? 0) + 1;
  gen.set(row, g);
  const cells = row.children;
  const padded = padRight(text, cells.length);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const glyph = cell.firstChild;
    const target = padded[i];
    const steps = spinSteps(glyph.textContent, target);
    let k = 0;
    setTimeout(function step() {
      if (gen.get(row) !== g) return;
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
