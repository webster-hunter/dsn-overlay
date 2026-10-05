import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeMatchFor } from '../proxy/deadlock.js';

test('activeMatchFor short-circuits on invalid account IDs without network calls', async () => {
  const invalidIds = [0, -1, null, undefined, NaN, '', 1.5];

  for (const invalidId of invalidIds) {
    const result = await activeMatchFor(invalidId);
    assert.equal(result, null, `should return null for ${typeof invalidId === 'number' && Number.isNaN(invalidId) ? 'NaN' : JSON.stringify(invalidId)}`);
  }
});
