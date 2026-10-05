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

/**
 * Chat adds the project's first URL sink: an <img src> next to text a stranger
 * typed. Both URL builders must stay pinned to their CDN base and validate the
 * id, so no part of a message can ever reach src — not as a scheme, not as a
 * host, not as a path escape.
 */
test('emote URLs are built from a fixed base and a validated id', () => {
  const src = readFileSync('overlay/emotes.js', 'utf8');
  assert.doesNotMatch(src, /https?:\/\/\$\{/, 'a CDN host must never be interpolated');
  for (const fn of ['twitchEmoteUrl', 'bttvEmoteUrl']) {
    const body = src.match(new RegExp(`${fn} = [^;]+;`))?.[0];
    assert.ok(body, `${fn} must exist`);
    assert.match(body, /SAFE_ID\.test\(id\)/, `${fn} must validate the id before building a URL`);
  }
});

/**
 * Every `src` assignment anywhere in overlay/, not just chat's.
 *
 * Enumerated for the same reason the sink tests above are: the chat rail was
 * the project's first URL sink, the chiron's hero icon is the second, and a
 * hardcoded file list would not have noticed the second one arrive.
 *
 * The rule a grep can actually enforce is that no URL is CONSTRUCTED at the
 * assignment site — no template literal, no concatenation. Every src must be a
 * value a builder already returned, and each builder carries its own test that
 * it validates its id (heroIconUrl in tests/chiron.test.js, the two emote
 * builders in tests/chat.test.js). Taint analysis is beyond a regex; forbidding
 * string-building where the sink is, is not.
 */
for (const name of readdirSync('overlay').filter(f => f.endsWith('.js'))) {
  test(`overlay/${name} never builds a URL at the src assignment`, () => {
    const src = readFileSync(`overlay/${name}`, 'utf8');
    for (const assign of src.match(/\.src\s*=\s*[^;]+;/g) ?? []) {
      assert.doesNotMatch(assign, /[`]/,
        `a template literal in a src assignment builds a URL in place: ${assign}`);
      assert.doesNotMatch(assign, /\+/,
        `concatenation in a src assignment builds a URL in place: ${assign}`);
    }
  });
}
