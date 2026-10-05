import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * The overlay renders Steam persona names, which are attacker-controlled.
 * Only logo.js may use innerHTML, and only to inject the three SVG layers we
 * vendor ourselves into overlay/logo/ — never anything from the API.
 *
 * Enumerated, not hardcoded: a fixed file list silently stops covering new
 * renderers (e.g. a future overlay/machine.js) the moment they're added.
 */
const API_FACING = readdirSync('overlay').filter(f => f.endsWith('.js') && f !== 'logo.js');

for (const name of API_FACING) {
  const file = `overlay/${name}`;
  test(`${file} has no innerHTML sink`, () => {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /\binnerHTML\b/,
      `${file} renders API-sourced strings; use textContent, not innerHTML`);
  });

  test(`${file} does not use insertAdjacentHTML, document.write, eval, or Function construction`, () => {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /insertAdjacentHTML|document\.write|outerHTML\s*=|\beval\(|new\s+Function\(/,
      `${file} must not parse strings as HTML or code`);
  });
}

test('logo.js innerHTML is confined to locally vendored SVG', () => {
  const src = readFileSync('overlay/logo.js', 'utf8');
  // It may use innerHTML, but only on text fetched from our own logo/ dir.
  assert.match(src, /fetch\(`logo\/\$\{\w+\}\.svg`\)|fetch\('logo\//,
    'logo.js must read its SVG from the vendored local directory');
  assert.doesNotMatch(src, /api\.deadlock-api\.com|assets-bucket/,
    'logo.js must not fetch SVG from the network at runtime');
});
