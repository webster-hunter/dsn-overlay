import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTransition } from '../overlay/machine.js';

const s = (phase, matchId = null) => ({ phase, matchId });

test('entering a match sweeps — nothing may be occluded', () => {
  assert.equal(nextTransition(s('QUEUE'), s('MATCH', 1)), 'sweep');
  assert.equal(nextTransition(s('IDLE'), s('MATCH', 1)), 'sweep');
});

test('a match ending runs the ident — full cover is free there', () => {
  assert.equal(nextTransition(s('MATCH', 1), s('RECAP', 1)), 'ident');
  assert.equal(nextTransition(s('RECAP', 1), s('IDLE')), 'ident');
  // RECAP is not implemented upstream, so MATCH -> IDLE direct is today's
  // real production path for a match ending, and must still get the ident
  assert.equal(nextTransition(s('MATCH', 1), s('IDLE')), 'ident');
  assert.equal(nextTransition(s('MATCH', 1), s('QUEUE')), 'ident');
});

test('queueing up or backing out of queue is the most frequent boundary — hard cut, no occlusion', () => {
  assert.equal(nextTransition(s('IDLE'), s('QUEUE')), null);
  assert.equal(nextTransition(s('QUEUE'), s('IDLE')), null);
});

test('no phase change means no transition', () => {
  assert.equal(nextTransition(s('MATCH', 1), s('MATCH', 1)), null);
  assert.equal(nextTransition(s('IDLE'), s('IDLE')), null);
});

test('a new match id while already in MATCH sweeps rather than doing nothing', () => {
  assert.equal(nextTransition(s('MATCH', 1), s('MATCH', 2)), 'sweep',
    'back-to-back games must not render the old roster');
});

test('a null or first state does not transition', () => {
  assert.equal(nextTransition(null, s('MATCH', 1)), null);
  assert.equal(nextTransition(undefined, s('IDLE')), null);
});
