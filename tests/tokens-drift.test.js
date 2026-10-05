import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * `npm run tokens` regenerates overlay/tokens.css from the Deadlock palette
 * endpoint, and everything that is NOT palette is a static literal inside
 * scripts/tokens.mjs. Those two drifted: every layout and animation token the
 * overlay was retuned through lived only in the committed CSS, so regenerating
 * after a Deadlock patch would have silently reverted the 16:9 gameplay area
 * (--rail-width 320 -> 403), dropped --topbar-height entirely, and put the logo
 * back to spinning passively instead of turning on each chiron turn.
 *
 * Nothing failed when that happened. The overlay just came back wrong, a patch
 * later, with no diff to blame — which is why this is a test and not a comment.
 *
 * Compared as text so neither file has to be imported: the generator fetches
 * the palette at module load, and a test must not depend on the network.
 */

const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '');   // both files use /* */

/** Literal `--name: value;` declarations. Templated palette lines never match. */
function declarations(src) {
  const out = new Map();
  for (const [, name, value] of strip(src).matchAll(/(--[a-z0-9-]+):\s*([^;\n]+);/gi)) {
    out.set(name, value.trim());
  }
  return out;
}

/**
 * The palette half is whatever the fetch produced; the static half is the
 * literals in the generator. They are split at the layout marker rather than by
 * guessing at token names — the endpoint serves names like
 * `--alternate-progress-bar-yellow`, so no suffix rule identifies a palette
 * token reliably.
 */
const LAYOUT_MARKER = '/* --- layout, from spec section 4.1 --- */';
function staticHalf(src, file) {
  const at = src.indexOf(LAYOUT_MARKER);
  assert.ok(at > 0, `${file} no longer contains the layout marker that splits it`);
  return src.slice(at);
}

const generator = declarations(staticHalf(readFileSync('scripts/tokens.mjs', 'utf8'), 'the generator'));
const committed = declarations(staticHalf(readFileSync('overlay/tokens.css', 'utf8'), 'tokens.css'));

test('the generator and the committed tokens agree on every static token', () => {
  assert.ok(generator.size > 5, `parsed only ${generator.size} tokens from the generator`);
  for (const [name, value] of generator) {
    assert.equal(committed.get(name), value,
      `${name}: generator says ${value}, overlay/tokens.css says ${committed.get(name)} — ` +
      'running `npm run tokens` would change the overlay. Update whichever is stale.');
  }
});

test('every static token the committed file carries is also emitted', () => {
  // The reverse direction, which is the one that actually broke: --topbar-height
  // existed only in the CSS, so regenerating deleted it and collapsed the layout.
  for (const name of committed.keys()) {
    assert.ok(generator.has(name),
      `${name} is in overlay/tokens.css but scripts/tokens.mjs does not emit it — ` +
      '`npm run tokens` would delete it');
  }
});

test('no token survives in the generator with nothing left to read it', () => {
  // The split-flap board was deleted; its tokens went with it. A token the
  // generator still emits but no rule or script reads is the next --flap-cell-w.
  // Enumerated, not listed. A hardcoded list silently stops covering a new file
  // the moment one is added — this one had already drifted, omitting
  // machine.js. tests/injection.test.js reads the directory for the same reason.
  const sources = readdirSync('overlay')
    .filter(f => f.endsWith('.js') || f.endsWith('.css'))
    .filter(f => f !== 'tokens.css')               // the generated file itself
    .map(f => readFileSync(`overlay/${f}`, 'utf8'))
    .join('\n');

  const unread = [...generator.keys()].filter(name =>
    !sources.includes(`var(${name})`) &&
    !sources.includes(`'${name}'`) &&                            // read by cssMs / getPropertyValue
    !generator.get(name)?.includes('var(')                       // an alias, e.g. --team-amber
  );
  assert.deepEqual(unread, [],
    `these tokens are generated but nothing reads them: ${unread.join(', ')}`);
});
