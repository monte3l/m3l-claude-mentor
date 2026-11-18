import { setTimeout as delay } from "node:timers/promises";
import {
  readTextBounded,
  writeTextAtomic,
} from "../../../src/internal/fs-atomic.ts";
import { withStateLock } from "../../../src/internal/lock.ts";

/**
 * Fixture child for lock-concurrency.test.ts: increments the counter kept in
 * the goals file, inside the real state lock. Argv: <dir> <timeoutMs> <startAt>. Every child waits until the
 * epoch-ms `startAt` before acquiring, so all of them contend at once.
 * Setting M3L_FIXTURE_NO_LOCK=1 skips the lock (used by hand to prove the
 * test can lose updates; never as a permanent assertion).
 */
const [dir, timeoutArg, startArg] = process.argv.slice(2);
if (dir === undefined || timeoutArg === undefined || startArg === undefined) {
  throw new Error("usage: lock-increment.ts <dir> <timeoutMs> <startAt>");
}

async function increment(): Promise<void> {
  const raw = (await readTextBounded(dir as string, "goals", 100)) ?? "0";
  const next = Number.parseInt(raw, 10) + 1;
  // A short pause widens the read-modify-write window.
  await delay(3);
  await writeTextAtomic(dir as string, "goals", String(next));
}

while (Date.now() < Number(startArg)) {
  // Busy-wait: the start barrier must release every child together.
}

if (process.env["M3L_FIXTURE_NO_LOCK"] === "1") {
  await increment();
} else {
  await withStateLock(dir, increment, {
    timeoutMs: Number(timeoutArg),
    staleMs: 60_000,
  });
}
