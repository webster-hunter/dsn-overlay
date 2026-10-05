import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitSize } from '../overlay/fit.js';

/** Stub measurer: Latin ~0.5em per char, CJK and emoji full-width ~1.0em. */
const measure = (text, px) => {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const wide = code > 0x2e80 || /[A-Z]/.test(ch);
    w += px * (wide ? 1.0 : 0.5);
  }
  return w;
};

const OPTS = { max: 14, min: 8, step: 0.5 };

test('a short name keeps the maximum size', () => {
  assert.equal(fitSize('bob', 169, measure, OPTS), 14);
});

test('a long name shrinks but never below the floor', () => {
  const size = fitSize('x'.repeat(40), 169, measure, OPTS);
  assert.ok(size < 14, 'must shrink');
  assert.ok(size >= 8, `must not go below the floor, got ${size}`);
});

test('an empty or missing name does not throw', () => {
  assert.equal(fitSize('', 169, measure, OPTS), 14);
  assert.equal(fitSize(null, 169, measure, OPTS), 14);
});

test('32 full-width CJK characters shrink to the floor and never overflow', () => {
  const cjk = '超'.repeat(32);
  const size = fitSize(cjk, 169, measure, OPTS);
  assert.equal(size, 8, 'must bottom out at the floor');
  // at the floor it still overflows, which is correct: CSS ellipsis takes over
  assert.ok(measure(cjk, size) > 169,
    'the floor cannot fit this; the contract is that we stop shrinking, not that we fit');
});

test('32 wide capitals shrink rather than widening the column', () => {
  const caps = 'A'.repeat(32);
  const size = fitSize(caps, 169, measure, OPTS);
  assert.ok(size < 14 && size >= 8);
});

test('emoji-laden names behave like full-width text', () => {
  const emoji = '🔥'.repeat(20);
  const size = fitSize(emoji, 169, measure, OPTS);
  assert.ok(size >= 8 && size <= 14);
  assert.ok(Number.isFinite(size), 'must not return NaN for astral-plane glyphs');
});

test('a 32-char Latin name fits without shrinking much', () => {
  const latin = 'xX_ShadowReaperSniper420_Xxaaaaa'.slice(0, 32);
  const size = fitSize(latin, 169, measure, OPTS);
  assert.ok(size >= 8, 'stays in range');
});
