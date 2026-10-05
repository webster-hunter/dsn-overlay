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
  mark.addEventListener('animationend', onMarkAnimEnd);
  mark.addEventListener('animationcancel', onMarkAnimEnd);
  host.replaceChildren(mark);
  return mark;
}

/**
 * Every movement is a one-shot class. One listener per mark, attached at mount,
 * strips the class when that class's own animation ends or is cancelled — so
 * nothing races a hardcoded duration and no listener is ever added again.
 */
const ONE_SHOT = { 'mark-turn': 'turn', 'mark-blink': 'blink', 'mark-sweep': 'sweep' };

function onMarkAnimEnd(e) {
  const cls = ONE_SHOT[e.animationName];
  if (cls) e.currentTarget.classList.remove(cls);
}

function play(mark, cls) {
  mark.classList.remove(cls);
  void mark.offsetWidth;            // force reflow so the animation restarts
  mark.classList.add(cls);
}

/**
 * The mark's resting angle. Both kinds of rotation advance it rather than
 * turning from zero, so the mark carries on from wherever it stopped instead
 * of snapping back.
 */
function advance(mark, degrees) {
  const now = parseFloat(mark.style.getPropertyValue('--mark-turn')) || 0;
  mark.style.setProperty('--mark-turn', `${now + degrees}deg`);
}

/**
 * One notch and one blink, fired when the chiron turns. The mark does nothing
 * passively — it moves only when something else on screen moves, which lets the
 * browser source idle in between. --mark-step x 10 chiron turns is a full
 * revolution, i.e. the same 90s cadence the old continuous spin had.
 *
 * The two run on separate classes so their durations stay independent; coupling
 * them to one class would make the shorter animation cut the longer one short.
 */
export function turnLogo(mark) {
  if (!mark) return;
  const step = parseFloat(getComputedStyle(mark).getPropertyValue('--mark-step')) || 36;
  advance(mark, step);
  play(mark, 'turn');
  play(mark, 'blink');
}

/**
 * One 180 degree turn to mark a state boundary. Occludes nothing, and runs from
 * the mark's current resting angle rather than snapping to zero first.
 */
export function sweepLogo(mark) {
  if (!mark) return;
  advance(mark, 180);
  play(mark, 'sweep');
}
