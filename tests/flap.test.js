import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARSET, padRight, spinSteps } from '../overlay/flap.js';

test('values are right-justified into a fixed width', () => {
  assert.equal(padRight('4', 11),           '          4');
  assert.equal(padRight('147-117', 11),     '    147-117');
  assert.equal(padRight('ASCENDANT 6', 11), 'ASCENDANT 6');
  assert.equal(padRight('', 11).length, 11);
});

test('overlong values truncate from the left, keeping the significant end', () => {
  // right-justified, so the rightmost characters are the ones that matter
  assert.equal(padRight('ABCDEFGHIJKLM', 11), 'CDEFGHIJKLM');
  assert.equal(padRight('ABCDEFGHIJKLM', 11).length, 11);
});

test('the charset covers every glyph the board can display', () => {
  for (const ch of 'WL0123456789-%/ ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    assert.ok(CHARSET.includes(ch), `charset missing ${JSON.stringify(ch)}`);
  }
});

test('spin always moves and is capped', () => {
  assert.ok(spinSteps('A', 'A', 14) > 0, 'an unchanged glyph must still flap');
  assert.ok(spinSteps('A', 'B', 14) <= 14);
  assert.ok(spinSteps(' ', 'Z', 14) <= 14);
  for (const from of CHARSET) {
    for (const to of CHARSET) {
      const n = spinSteps(from, to, 14);
      assert.ok(n >= 1 && n <= 14, `spinSteps(${from},${to}) = ${n}`);
    }
  }
});

test('spin is deterministic — the same pair always gives the same count', () => {
  assert.equal(spinSteps('A', 'Q', 14), spinSteps('A', 'Q', 14));
});
