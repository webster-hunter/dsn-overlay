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

test('chat.js sets img.src only from the emote URL builders', () => {
  const src = readFileSync('overlay/chat.js', 'utf8');
  for (const assign of src.match(/\.src\s*=\s*[^;]+;/g) ?? []) {
    assert.match(assign, /part\.url/,
      `img.src must come from tokenise(), not from a message: ${assign}`);
  }
});
