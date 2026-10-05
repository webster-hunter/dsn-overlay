import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARSET, padRight, spinSteps, setFlapRow } from '../overlay/flap.js';

/** Minimal DOM-free stand-in for a flap cell + its glyph span. */
function stubRow(n) {
  const cells = [];
  for (let i = 0; i < n; i++) {
    cells.push({
      firstChild: { textContent: ' ' },
      classList: { add() {}, remove() {} },
      style: { setProperty() {}, removeProperty() {} },
      offsetWidth: 0
    });
  }
  return { children: cells };
}

/**
 * A real setTimeout/wall-clock interrupt is flaky — whether the race in
 * setFlapRow actually clobbers depends on exact millisecond timing, which
 * varies by machine load. This replaces global setTimeout with a virtual
 * clock for the duration of the test: calls queue instead of firing, and
 * `advance(ms)` drains everything due by then, in time order, synchronously.
 * Not a fake-timer dependency — just explicit draining of a tiny local queue.
 */
function withVirtualClock(fn) {
  const real = globalThis.setTimeout;
  let now = 0;
  const queue = [];
  globalThis.setTimeout = (cb, ms = 0) => { queue.push({ time: now + ms, cb }); };
  try {
    fn({
      advance(ms) {
        const until = now + ms;
        queue.sort((a, b) => a.time - b.time);
        while (queue.length && queue[0].time <= until) {
          const ev = queue.shift();
          now = ev.time;
          ev.cb();
          queue.sort((a, b) => a.time - b.time);
        }
        now = until;
      }
    });
  } finally {
    globalThis.setTimeout = real;
  }
}

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
  // pinned to the actual arithmetic — `<= 14` alone is true for any input
  // by construction (spinSteps always returns Math.min(x, cap)) and cannot fail
  assert.equal(spinSteps('A', 'B', 14), 1);
  // raw distance from ' ' to 'Z' is 26, which exceeds the 14 cap — pinning
  // this to 14 (not just asserting <= 14) is what actually exercises the cap
  assert.equal(spinSteps(' ', 'Z', 14), 14);
  // the cap is a parameter, not hardwired to 14 — prove a smaller one engages too
  assert.equal(spinSteps('A', 'Z', 3), 3, 'a tighter cap must still be honoured');
  for (const from of CHARSET) {
    for (const to of CHARSET) {
      const n = spinSteps(from, to, 14);
      assert.ok(n >= 1, `spinSteps(${from},${to}) = ${n}`);
    }
  }
});

test('spin is deterministic — the same pair always gives the same count', () => {
  assert.equal(spinSteps('A', 'Q', 14), spinSteps('A', 'Q', 14));
});

test('a second setFlapRow call supersedes an in-flight one — no splice of both targets', () => {
  withVirtualClock(({ advance }) => {
    const row = stubRow(4);
    // 'Z' is maximally far from the initial blank, so the first chain is
    // still deep in its 14-step cascade (worth ~812ms of ticks) when the
    // interrupt lands at 200ms — every cell is still mid-flight, not just
    // settling. 'H' is a short hop from wherever that cascade has reached by
    // then, so the second chain finishes well before the first chain's
    // leftover ticks are done firing: exactly the ordering that exposes the
    // bug (the superseded chain's later tick overwrites the winner).
    setFlapRow(row, 'ZZZZ', null);
    advance(200);
    setFlapRow(row, 'HHHH', null);
    advance(2000);                 // generous upper bound: worst case is cap(14) steps * 58ms + cascade offset
    const glyphs = row.children.map(c => c.firstChild.textContent);
    assert.deepEqual(glyphs, ['H', 'H', 'H', 'H'],
      `superseded chain must not land its own target; got ${JSON.stringify(glyphs)}`);
  });
});
