/**
 * A .env reader small enough not to justify a dependency — this project ships
 * none, and the whole need is one numeric account id.
 *
 * Node's own `--env-file` would also do it, but only when the process is
 * launched with that flag. `node proxy/server.js` and the test suite would
 * silently miss the file, which is exactly the "works on my machine" trap a
 * setup convenience is supposed to remove. Reading it here covers every entry
 * point that imports config.js.
 */
import { readFileSync } from 'node:fs';

/** KEY=value lines. Blank lines and # comments are skipped. */
export function parseEnv(text) {
  const out = {};
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // Split on the FIRST '=' so values may contain more of them.
    const eq = line.indexOf('=');
    if (eq < 1) continue;                      // no key, or no '=' at all

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip one matched pair of surrounding quotes, so `ID="123"` works too.
    const quoted = value.length > 1
      && (value[0] === '"' || value[0] === "'")
      && value[value.length - 1] === value[0];
    if (quoted) value = value.slice(1, -1);

    out[key] = value;
  }
  return out;
}

/**
 * Apply a .env file to `env`, without clobbering anything already set — so
 * `DSN_ACCOUNT_ID=... npm run serve` still overrides the file for a one-off.
 * A missing file is the normal case for a fresh checkout, not an error.
 * Returns what was parsed, for tests and diagnostics.
 */
export function loadEnv(path, env = process.env) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const parsed = parseEnv(text);
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) env[key] = value;
  }
  return parsed;
}
