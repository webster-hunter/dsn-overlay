/**
 * Largest size in [min, max] at which `text` fits `available` px, stepping down
 * by `step`. Returns `min` if even that overflows — the caller then relies on
 * CSS ellipsis. `measure(text, px) -> width` is injected so this is testable
 * without a DOM.
 */
export function fitSize(text, available, measure, { max = 14, min = 8, step = 0.5 } = {}) {
  const t = String(text ?? '');
  if (!t) return max;
  let size = max;
  while (size > min && measure(t, size) > available) size -= step;
  return size;
}

/** Real measurer for the browser. Reuses one canvas. */
export function canvasMeasurer(family = 'Radiance, system-ui, sans-serif', weight = 600) {
  const ctx = document.createElement('canvas').getContext('2d');
  return (text, px) => {
    ctx.font = `${weight} ${px}px ${family}`;
    return ctx.measureText(text).width;
  };
}
