import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LockOptions } from "../../../src/internal/lock.ts";
import {
  runHookCore,
  type HookDeps,
  type HookHandler,
  type HookRunResult,
} from "../../../src/hooks/runtime.ts";
import type { HookSettings } from "../../../src/hooks/settings.ts";
import { NOW } from "./helpers.ts";

export const LOCK = ".state.lock";
export const FOREIGN = JSON.stringify({
  v: 1,
  pid: 424242,
  host: "foreign-host-xyz",
  token: "foreign-token",
  createdAt: 0,
});

/** Lock options on a fake clock that `sleep` advances: a 50 ms timeout costs nothing. */
export function fakeLock(): { lock: LockOptions; sleeps: number[] } {
  let t = Date.now();
  const sleeps: number[] = [];
  return {
    sleeps,
    lock: {
      timeoutMs: 50,
      now: () => t,
      sleep: (ms: number) => {
        sleeps.push(ms);
        t += ms;
        return Promise.resolve();
      },
    },
  };
}

/** Lock options whose `sleep` fails the test: the code under test must never wait. */
export function noWaitLock(): LockOptions {
  return {
    timeoutMs: 50,
    sleep: () => Promise.reject(new Error("must not wait for the lock")),
  };
}

export function seedForeignLock(dir: string): void {
  writeFileSync(join(dir, LOCK), FOREIGN);
}

export function lockFiles(dir: string): string[] {
  return readdirSync(dir).filter((n) => n.startsWith(LOCK));
}

/** Runs `handler` through runHookCore (so stderr is the real one-line note) with `lockOptions` injected. */
export function runWithLock(
  name: string,
  handler: HookHandler,
  payload: Readonly<Record<string, unknown>>,
  dir: string,
  lockOptions: LockOptions,
  extras: { readonly now?: number; readonly settings?: HookSettings } = {},
): Promise<HookRunResult> {
  return runHookCore(
    name,
    {
      stdinText: JSON.stringify(payload),
      env: { CLAUDE_PLUGIN_DATA: dir },
      now: extras.now ?? NOW,
    },
    (p, deps: HookDeps) =>
      handler(p, {
        ...deps,
        lockOptions,
        ...(extras.settings === undefined ? {} : { settings: extras.settings }),
      }),
  );
}

/**
 * Lock options on a fake clock whose FIRST `sleep` runs `competitor` (a
 * competing process finishing its write) and then removes the foreign lock,
 * so the next attempt acquires and must re-read everything inside the lock.
 */
export function releasingLock(
  dir: string,
  competitor: () => void | Promise<void>,
): { lock: LockOptions; sleeps: number[] } {
  let t = Date.now();
  const sleeps: number[] = [];
  return {
    sleeps,
    lock: {
      timeoutMs: 5000,
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
        if (sleeps.length === 1) {
          await competitor();
          rmSync(join(dir, LOCK));
        }
      },
    },
  };
}
