import { join, normalize } from 'node:path';

const ROOT = 'overlay';

/**
 * Map a request pathname to a file under `overlay/`, safely.
 *
 * Safe against traversal, but for non-obvious reasons worth naming so a later
 * "simplification" does not remove the protection. Two independent layers:
 *   1. WHATWG URL collapses `..` segments and decodes %2e in `pathname` before
 *      this is called, so `/%2e%2e/%2e%2e/x` arrives as `/x`.
 *   2. `path.normalize` CLAMPS `..` at root for a `/`-prefixed path: it yields a
 *      root-relative `x`, never `../../x`.
 * The `.replace` covers the no-leading-slash case. Verified against 13 attack
 * vectors (encoded, double-encoded, `....//`, null byte, backslash); see
 * tests/static.test.js.
 */
export function resolveStatic(pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  return join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
}
