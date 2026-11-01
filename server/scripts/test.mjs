// Runs the server tests, re-running only the test files whose worker process died natively.
//
// On Node 24.15.0 for Windows, a test worker occasionally exits with code 0xC0000409 and no
// message. Each file runs in its own worker, so only that file is lost; every other file still
// reports normally. This script re-runs just the lost files, up to MAX_ATTEMPTS runs in total.
// Anything else (a failed test, a different kind of error) stops immediately and is never retried.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_ATTEMPTS = 4;
const WORKER_CRASH = /Worker exited unexpectedly/;
const CRASHED_FILE = /while running test file\s+(\S[^\r\n]*?\.test\.[cm]?[jt]sx?)/g;
const REPORTED_FAILURE = /Tests\s+.*\d+ failed|Test Files\s+.*\d+ failed|FAIL\s/;

const candidates = [
  new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
  new URL('../../node_modules/vitest/vitest.mjs', import.meta.url),
];
const vitest = candidates.map((url) => fileURLToPath(url)).find((path) => existsSync(path));
if (!vitest) {
  console.error('Could not find Vitest. Run `npm install` first.');
  process.exit(1);
}

let filters = process.argv.slice(2);

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const result = spawnSync(process.execPath, [vitest, 'run', ...filters], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');

  if (result.status === 0) process.exit(0);

  const output = `${result.stdout}\n${result.stderr}`;
  const onlyWorkerCrashes = WORKER_CRASH.test(output) && !REPORTED_FAILURE.test(output);
  if (!onlyWorkerCrashes || attempt === MAX_ATTEMPTS) process.exit(result.status ?? 1);

  // Narrow the next run to the files that were lost. If they cannot be identified, run it all again.
  const lost = [...new Set([...output.matchAll(CRASHED_FILE)].map((match) => match[1].trim()))];
  if (lost.length > 0) filters = lost;

  console.warn(
    `\n>>> A test worker crashed (known Node 24 on Windows issue); no test failed. ` +
      (lost.length > 0
        ? `Re-running only the ${lost.length} affected file(s) `
        : 'Re-running everything ') +
      `(attempt ${attempt + 1} of ${MAX_ATTEMPTS}).\n`,
  );
}
