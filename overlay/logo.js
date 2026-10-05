// Valve's logo ships as three separate SVGs so the eye can animate on its own.
// Paths are fill="white" with no groups or clip paths, so swapping the fill to
// currentColor is the whole recolouring story.
const LAYERS = ['outer', 'inner_noeye', 'eye'];

const toCurrentColor = svg => svg
  .replace(/\swidth="[^"]*"/i, '')
  .replace(/\sheight="[^"]*"/i, '')
  .replace(/fill="white"/gi, 'fill="currentColor"');

export async function mountLogo(host) {
  const svgs = await Promise.all(
    LAYERS.map(n => fetch(`logo/${n}.svg`).then(r => r.text()))
  );
  const mark = document.createElement('div');
  mark.className = 'mark';
  LAYERS.forEach((name, i) => {
    const layer = document.createElement('div');
    // class names 'outer' and 'eye' are what overlay.css animates
    layer.className = `layer ${name === 'inner_noeye' ? 'inner' : name}`;
    layer.innerHTML = toCurrentColor(svgs[i]);
    mark.appendChild(layer);
  });
  host.replaceChildren(mark);
  return mark;
}

/**
 * One 180 degree turn to mark a state boundary. Occludes nothing.
 * Cleanup rides the animation's own 'animationend' rather than a timer, so it
 * can never desync from --xition-sweep (tokens.css) however that is tuned.
 */
export function sweepLogo(mark) {
  if (!mark) return;
  mark.classList.remove('sweep');
  void mark.offsetWidth;            // force reflow so the animation restarts
  mark.classList.add('sweep');
  mark.addEventListener('animationend', function onEnd(e) {
    if (e.animationName !== 'mark-sweep') return;
    mark.removeEventListener('animationend', onEnd);
    mark.classList.remove('sweep');
  });
}
