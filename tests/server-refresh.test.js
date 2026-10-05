import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * proxy/server.js has no exported seams other than `doRefresh` and `current`,
 * and binds a real port plus a 15s setInterval as a side effect of import —
 * both guarded behind an `isMain` check so a test import does neither. This
 * file still mutates process.env and globalThis.fetch before that import, so
 * it must run in its own process: `node --test` gives each matched file that
 * isolation, which is what makes this safe alongside the rest of the suite.
 */
process.env.DSN_ACCOUNT_ID = '123456789';   // bypass the ACCOUNT_ID early-return
process.env.PORT = '0';                     // never touch a real port, just in case

const outage = new Error('simulated upstream outage');
globalThis.fetch = async () => { throw outage; };

const mod = await import('../proxy/server.js');

test('a failed refresh wires through fallbackState: current ends up stale with the error as reason', async () => {
  assert.equal(mod.current.phase, 'IDLE', 'precondition: starts at the cold-start placeholder');

  await mod.doRefresh();

  // Re-read mod.current (not a destructured copy) — it's a live ES module
  // binding, so this sees the reassignment doRefresh() just made.
  assert.equal(mod.current.stale, true);
  assert.ok(mod.current.reason.includes('simulated upstream outage'),
    `reason should carry the thrown error's message, got: ${mod.current.reason}`);
  // Shape parity must survive the failure path too.
  assert.equal(mod.current.teams.length, 2);
});
