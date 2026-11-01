// Runs the server tests, re-running only when a Vitest worker process died natively.
//
// On Node 24.15.0 for Windows, a test worker occasionally exits with code 0xC0000409 and no
// message, taking no test with it. Every test that ran has passed; the run just ends early.
// Real failures are never retried: a run that reports a failed test, or any other kind of error,
// stops immediately.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_ATTEMPTS = 3;
const WORKER_CRASH = /Worker exited unexpectedly/;
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

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const result = spawnSync(process.execPath, [vitest, 'run', ...process.argv.slice(2)], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');

  if (result.status === 0) process.exit(0);

  const output = `${result.stdout}\n${result.stderr}`;
  const onlyAWorkerCrash = WORKER_CRASH.test(output) && !REPORTED_FAILURE.test(output);
  if (!onlyAWorkerCrash || attempt === MAX_ATTEMPTS) process.exit(result.status ?? 1);

  console.warn(
    `\n>>> A test worker crashed (known Node 24 on Windows issue); no test failed. ` +
      `Re-running (attempt ${attempt + 1} of ${MAX_ATTEMPTS}).\n`,
  );
}
