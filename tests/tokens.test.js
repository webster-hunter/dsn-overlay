import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const CSS = 'overlay/tokens.css';

test('tokens.css exists and was generated', () => {
  assert.ok(existsSync(CSS), 'run `npm run tokens` to generate it');
});

test('tokens.css defines the colours the overlay depends on', () => {
  const css = readFileSync(CSS, 'utf8');
  for (const name of ['--team1-color', '--team2-color', '--base-text', '--color-gold']) {
    assert.match(css, new RegExp(`${name}\\s*:\\s*#[0-9A-Fa-f]{6}`), `missing ${name}`);
  }
});

test('vendored fonts and logo layers are present', () => {
  for (const f of [
    'overlay/fonts/radiance-semibold.otf',
    'overlay/fonts/radiancem-semibold.otf',
    'overlay/fonts/reaver-bold.otf',
    'overlay/logo/outer.svg',
    'overlay/logo/inner_noeye.svg',
    'overlay/logo/eye.svg'
  ]) {
    assert.ok(existsSync(f), `missing ${f} — run \`npm run vendor\``);
  }
});
