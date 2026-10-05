import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv, loadEnv } from '../proxy/env.js';

test('parses the shape a real .env has', () => {
  const parsed = parseEnv([
    '# a comment',
    '',
    'DSN_ACCOUNT_ID=123456788',
    '   PORT = 7331   ',
    'QUOTED="quoted value"',
    "SINGLE='single'",
    '#PORT=9999'
  ].join('\n'));

  assert.deepEqual(parsed, {
    DSN_ACCOUNT_ID: '123456788',
    PORT: '7331',
    QUOTED: 'quoted value',
    SINGLE: 'single'
  });
});

test('splits on the first = so values may contain more of them', () => {
  assert.equal(parseEnv('TOKEN=a=b=c').TOKEN, 'a=b=c');
});

test('ignores lines that are not assignments rather than inventing keys', () => {
  // A bare word, and a line starting with '=', are both malformed. Neither may
  // produce an entry — an empty-string key would shadow nothing and confuse.
  assert.deepEqual(parseEnv('JUST_A_WORD\n=novalue\n'), {});
});

test('strips only a matched pair of quotes', () => {
  assert.equal(parseEnv('A="unbalanced').A, '"unbalanced');
  assert.equal(parseEnv("B='x\"").B, "'x\"");
  assert.equal(parseEnv('C=""').C, '');
});

test('a real environment variable beats the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsn-env-'));
  const file = join(dir, '.env');
  writeFileSync(file, 'DSN_ACCOUNT_ID=from_file\nONLY_IN_FILE=yes\n');

  const env = { DSN_ACCOUNT_ID: 'from_environment' };
  loadEnv(file, env);

  // The file must not clobber an id passed for a one-off run.
  assert.equal(env.DSN_ACCOUNT_ID, 'from_environment');
  // But it still supplies what the environment did not set.
  assert.equal(env.ONLY_IN_FILE, 'yes');
});

test('an absent .env is the normal case, not an error', () => {
  const env = {};
  assert.deepEqual(loadEnv(join(tmpdir(), 'dsn-no-such-file-.env'), env), {});
  assert.deepEqual(env, {});
});
