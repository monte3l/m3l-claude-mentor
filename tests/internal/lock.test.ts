import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  fstatSync,
  symlinkSync,
  openSync,
  closeSync,
  constants as fsConstants,
  unlinkSync,
  lutimesSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import { setTimeout as realDelay } from "node:timers/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MentorStateError } from "../../src/internal/errors.ts";
import {
  CLI_LOCK_TIMEOUT_MS,
  LOCK_FILE_NAME,
  LOCK_STALE_MS,
  LOCK_TIMEOUT_MS,
  withStateLock,
} from "../../src/internal/lock.ts";

let root: string;
let dir: string;
let lockPath: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lock-")));
  dir = join(root, "data");
  mkdirSync(dir);
  lockPath = join(dir, LOCK_FILE_NAME);
});

afterEach(() => {
  chmodSync(dir, 0o700);
  rmSync(root, { recursive: true, force: true });
});

/** A fake clock whose `sleep` advances `now` and records each request. */
function makeClock() {
  let t = Date.now();
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    elapsed: (from: number) => t - from,
    start: t,
    sleep: (ms: number): Promise<void> => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
  };
}

function leftovers(): string[] {
  return readdirSync(dir).filter((n) => n.startsWith(".state.lock"));
}

function seed(content: string, ageMs: number): void {
  writeFileSync(lockPath, content);
  const when = (Date.now() - ageMs) / 1000;
  utimesSync(lockPath, when, when);
}

/**
 * Content and mtime of the lock file from ONE descriptor, so there is no
 * stat-then-read of the same path between the two observations.
 */
function observeLock(): { content: string; mtimeMs: number } {
  const fd = openSync(lockPath, "r");
  try {
    return {
      content: readFileSync(fd, "utf8"),
      mtimeMs: fstatSync(fd).mtimeMs,
    };
  } finally {
    closeSync(fd);
  }
}

const FOREIGN = JSON.stringify({
  v: 1,
  pid: 424242,
  host: "foreign-host-xyz",
  token: "foreign-token",
  createdAt: 0,
});

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (error) {
    return error instanceof MentorStateError ? error.code : error;
  }
  return undefined;
}

describe("constants", () => {
  test("pin names and values", () => {
    expect(LOCK_FILE_NAME).toBe(".state.lock");
    expect(LOCK_TIMEOUT_MS).toBe(2000);
    expect(CLI_LOCK_TIMEOUT_MS).toBe(6000);
    expect(LOCK_STALE_MS).toBe(5000);
    expect(CLI_LOCK_TIMEOUT_MS).toBeGreaterThan(LOCK_STALE_MS);
  });
});

describe("acquire and release", () => {
  test("holds a JSON lock file inside fn and removes it after", async () => {
    let seen: Record<string, unknown> = {};
    await withStateLock(dir, () => {
      seen = JSON.parse(readFileSync(lockPath, "utf8")) as Record<
        string,
        unknown
      >;
      return Promise.resolve();
    });
    expect(seen["v"]).toBe(1);
    expect(seen["pid"]).toBe(process.pid);
    expect(typeof seen["host"]).toBe("string");
    expect(seen["host"]).toBe(hostname());
    expect(typeof seen["token"]).toBe("string");
    expect(seen["token"]).not.toBe("");
    expect(seen["createdAt"]).toBeDefined();
    expect(existsSync(lockPath)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  test("passes fn's return value through", async () => {
    await expect(withStateLock(dir, () => Promise.resolve(42))).resolves.toBe(
      42,
    );
  });

  test("leaves no lock file and rethrows fn's own error unchanged", async () => {
    const boom = new Error("fn failed");
    await expect(withStateLock(dir, () => Promise.reject(boom))).rejects.toBe(
      boom,
    );
    expect(leftovers()).toEqual([]);
  });

  test("creates a missing data dir and locks it", async () => {
    const nested = join(root, "a", "b");
    let existedInside = false;
    await withStateLock(nested, () => {
      existedInside = existsSync(join(nested, LOCK_FILE_NAME));
      return Promise.resolve();
    });
    expect(existedInside).toBe(true);
    // readdirSync throws unless the directory exists, so it also proves creation.
    expect(readdirSync(nested)).toEqual([]);
  });

  test("works through a symlinked data dir and cleans the lock", async () => {
    const link = join(root, "link");
    symlinkSync(dir, link);
    let existedInside = false;
    await withStateLock(link, () => {
      existedInside = existsSync(lockPath);
      return Promise.resolve();
    });
    expect(existedInside).toBe(true);
    expect(leftovers()).toEqual([]);
  });
});

describe("contention", () => {
  test.each([0, 0.999999])(
    "a fresh foreign lock times out with LOCK_TIMEOUT (random=%s), untouched, bounded jittered backoff",
    async (rnd) => {
      seed(FOREIGN, 0);
      const before = observeLock();
      const clock = makeClock();
      let thrown: unknown;
      try {
        await withStateLock(dir, () => Promise.resolve(), {
          timeoutMs: 1000,
          now: clock.now,
          sleep: clock.sleep,
          random: () => rnd,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(MentorStateError);
      expect((thrown as MentorStateError).code).toBe("LOCK_TIMEOUT");
      const message = (thrown as MentorStateError).message;
      expect(message).not.toContain("424242");
      expect(message).not.toContain("foreign-host-xyz");
      expect(message).not.toContain(hostname());
      expect(clock.elapsed(clock.start)).toBeGreaterThanOrEqual(1000);
      expect(clock.sleeps.length).toBeGreaterThan(0);
      clock.sleeps.forEach((ms, n) => {
        const base = Math.min(25 * 2 ** n, 200);
        expect(ms).toBeLessThanOrEqual(base);
        if (n < clock.sleeps.length - 1) {
          expect(ms).toBeGreaterThanOrEqual(base * 0.5 - 1);
        }
      });
      if (rnd === 0) expect(clock.sleeps[0]).toBeLessThan(20);
      else expect(clock.sleeps[0]).toBeGreaterThan(20);
      const after = observeLock();
      expect(after.content).toBe(FOREIGN);
      expect(after.mtimeMs).toBe(before.mtimeMs);
    },
  );

  test("succeeds after the holder releases mid-wait", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let entered!: () => void;
    const holderIn = new Promise<void>((r) => {
      entered = r;
    });
    const holder = withStateLock(dir, async () => {
      entered();
      await gate;
    });
    await holderIn;
    const clock = makeClock();
    let first = true;
    const result = await withStateLock(dir, () => Promise.resolve("B"), {
      now: clock.now,
      random: () => 0.5,
      sleep: async (ms: number) => {
        if (first) {
          first = false;
          release();
          await holder;
        }
        await clock.sleep(ms);
      },
    });
    expect(result).toBe("B");
    expect(clock.sleeps.length).toBeGreaterThan(0);
    expect(leftovers()).toEqual([]);
  });

  test("two concurrent acquirers in one process serialize", async () => {
    // Each body is gated on the OTHER caller's sleep having been requested,
    // which proves the loser observed a held lock. The loser's sleep then
    // waits for the winner's body to end, so the order is structural.
    const events: string[] = [];
    let sawHeld!: () => void;
    const held = new Promise<void>((r) => {
      sawHeld = r;
    });
    let firstEnded!: () => void;
    const firstDone = new Promise<void>((r) => {
      firstEnded = r;
    });
    const sleep = async (): Promise<void> => {
      sawHeld();
      await firstDone;
    };
    let ended = 0;
    const body = (label: string) => async (): Promise<void> => {
      events.push(`${label}-start`);
      await held;
      events.push(`${label}-end`);
      ended += 1;
      if (ended === 1) firstEnded();
    };
    const opts = { timeoutMs: 30_000, sleep };
    // Fails fast and readably if no caller ever observes a held lock.
    let deadline: NodeJS.Timeout | undefined;
    const noContention = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => {
        reject(new Error("second acquirer never observed a held lock"));
      }, 1000);
    });
    try {
      await Promise.race([
        Promise.all([
          withStateLock(dir, body("A"), opts),
          withStateLock(dir, body("B"), opts),
        ]),
        noContention,
      ]);
    } finally {
      clearTimeout(deadline);
    }
    expect(events).toHaveLength(4);
    // never overlapping: each start is immediately followed by its own end
    expect(events[1]).toBe(events[0]?.replace("-start", "-end"));
    expect(events[3]).toBe(events[2]?.replace("-start", "-end"));
    expect(events[2]?.[0]).not.toBe(events[0]?.[0]);
    expect(leftovers()).toEqual([]);
  });
});

describe("staleness", () => {
  test("breaks a stale lock with no sleeping and takes it over", async () => {
    seed(FOREIGN, 60_000);
    const clock = makeClock();
    let token: unknown;
    await withStateLock(
      dir,
      () => {
        token = (
          JSON.parse(readFileSync(lockPath, "utf8")) as { token: unknown }
        ).token;
        return Promise.resolve();
      },
      { staleMs: 5000, now: clock.now, sleep: clock.sleep },
    );
    expect(clock.sleeps).toEqual([]);
    expect(typeof token).toBe("string");
    expect(token).not.toBe("foreign-token");
    expect(leftovers()).toEqual([]);
  });

  test.each(["", "not json {{", "\u0000\u0001"])(
    "breaks an OLD lock with content %j",
    async (content) => {
      seed(content, 60_000);
      const clock = makeClock();
      await expect(
        withStateLock(dir, () => Promise.resolve("ok"), {
          staleMs: 5000,
          now: clock.now,
          sleep: clock.sleep,
        }),
      ).resolves.toBe("ok");
      expect(clock.sleeps).toEqual([]);
      expect(leftovers()).toEqual([]);
    },
  );

  test.each(["", "not json {{", "\u0000\u0001"])(
    "holds a FRESH lock with content %j",
    async (content) => {
      seed(content, 0);
      const clock = makeClock();
      await expect(
        withStateLock(dir, () => Promise.resolve("ok"), {
          timeoutMs: 500,
          now: clock.now,
          sleep: clock.sleep,
        }),
      ).rejects.toMatchObject({ code: "LOCK_TIMEOUT" });
      expect(readFileSync(lockPath, "utf8")).toBe(content);
    },
  );

  test("a lock with an mtime in the future counts as live", async () => {
    writeFileSync(lockPath, FOREIGN);
    const future = (Date.now() + 60_000) / 1000;
    utimesSync(lockPath, future, future);
    const clock = makeClock();
    await expect(
      withStateLock(dir, () => Promise.resolve("ok"), {
        timeoutMs: 500,
        staleMs: 5000,
        now: clock.now,
        sleep: clock.sleep,
      }),
    ).rejects.toMatchObject({ code: "LOCK_TIMEOUT" });
    expect(readFileSync(lockPath, "utf8")).toBe(FOREIGN);
  });

  test("a dangling symlink at the lock path is judged by lstat and broken once old", async () => {
    symlinkSync(join(root, "nowhere"), lockPath);
    const old = (Date.now() - 60_000) / 1000;
    lutimesSync(lockPath, old, old);
    const clock = makeClock();
    await expect(
      withStateLock(dir, () => Promise.resolve("ok"), {
        staleMs: 5000,
        now: clock.now,
        sleep: clock.sleep,
      }),
    ).resolves.toBe("ok");
    expect(clock.sleeps).toEqual([]);
    expect(leftovers()).toEqual([]);
  });

  test("a fresh dangling symlink at the lock path is held", async () => {
    symlinkSync(join(root, "nowhere"), lockPath);
    const clock = makeClock();
    await expect(
      withStateLock(dir, () => Promise.resolve("ok"), {
        timeoutMs: 300,
        now: clock.now,
        sleep: clock.sleep,
      }),
    ).rejects.toMatchObject({ code: "LOCK_TIMEOUT" });
    expect(lstatSync(lockPath).isSymbolicLink()).toBe(true);
  });
});

describe("release ownership", () => {
  test("removes only our own token", async () => {
    const foreign = JSON.stringify({ v: 1, token: "someone-else" });
    await withStateLock(dir, () => {
      writeFileSync(lockPath, foreign);
      return Promise.resolve();
    });
    expect(readFileSync(lockPath, "utf8")).toBe(foreign);
  });
});

describe("re-entrancy", () => {
  test("a nested call for the same dir throws a plain Error at once", async () => {
    const clock = makeClock();
    let nested: unknown;
    await withStateLock(
      dir,
      async () => {
        try {
          await withStateLock(dir, () => Promise.resolve(), {
            now: clock.now,
            sleep: clock.sleep,
          });
        } catch (error) {
          nested = error;
        }
      },
      { now: clock.now, sleep: clock.sleep },
    );
    expect(nested).toBeInstanceOf(Error);
    expect(nested).not.toBeInstanceOf(MentorStateError);
    expect(clock.sleeps).toEqual([]);
    expect(leftovers()).toEqual([]);
  });

  test("a nested call for a different dir works", async () => {
    const other = join(root, "other");
    const result = await withStateLock(dir, () =>
      withStateLock(other, () => Promise.resolve("inner")),
    );
    expect(result).toBe("inner");
    expect(leftovers()).toEqual([]);
    expect(readdirSync(other)).toEqual([]);
  });
});

describe("failure and validation", () => {
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "an unwritable dir throws WRITE_FAILED immediately",
    async () => {
      chmodSync(dir, 0o500);
      const clock = makeClock();
      let thrown: unknown;
      try {
        await withStateLock(dir, () => Promise.resolve(), {
          now: clock.now,
          sleep: clock.sleep,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(MentorStateError);
      expect((thrown as MentorStateError).code).toBe("WRITE_FAILED");
      expect((thrown as MentorStateError).cause).toBeDefined();
      expect(clock.sleeps).toEqual([]);
    },
  );

  test("a relative dir is DATA_DIR_INVALID before any I/O", async () => {
    const rel = `lock-test-relative-${String(process.pid)}`;
    const call = async (): Promise<void> =>
      await withStateLock(rel, () => Promise.resolve());
    expect(await codeOf(call())).toBe("DATA_DIR_INVALID");
    expect(existsSync(join(process.cwd(), rel))).toBe(false);
  });

  test.each([0, -1])("timeoutMs %s is a RangeError", async (timeoutMs) => {
    const call = async (): Promise<void> =>
      await withStateLock(dir, () => Promise.resolve(), { timeoutMs });
    await expect(call()).rejects.toBeInstanceOf(RangeError);
  });

  test.each([0, -1])("staleMs %s is a RangeError", async (staleMs) => {
    const call = async (): Promise<void> =>
      await withStateLock(dir, () => Promise.resolve(), { staleMs });
    await expect(call()).rejects.toBeInstanceOf(RangeError);
  });
});

describe("stale lock in an unwritable dir", () => {
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "fails fast with WRITE_FAILED and no sleeping",
    async () => {
      seed(FOREIGN, 60_000);
      chmodSync(dir, 0o500);
      const clock = makeClock();
      let thrown: unknown;
      try {
        await withStateLock(dir, () => Promise.resolve(), {
          staleMs: 5000,
          now: clock.now,
          sleep: clock.sleep,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(MentorStateError);
      expect((thrown as MentorStateError).code).toBe("WRITE_FAILED");
      expect(clock.sleeps).toEqual([]);
    },
  );
});

describe("re-entrancy details and option edges", () => {
  test("is still detected after an await and after a setTimeout inside fn", async () => {
    const outcomes: unknown[] = [];
    await withStateLock(dir, async () => {
      await Promise.resolve();
      await realDelay(5);
      await new Promise<void>((r) => {
        setTimeout(r, 1);
      });
      try {
        await withStateLock(dir, () => Promise.resolve());
      } catch (error) {
        outcomes.push(error);
      }
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toBeInstanceOf(Error);
    expect(outcomes[0]).not.toBeInstanceOf(MentorStateError);
  });

  test("a sequential same-dir call after fn rejected works", async () => {
    await expect(
      withStateLock(dir, () => Promise.reject(new Error("first"))),
    ).rejects.toThrow("first");
    await expect(
      withStateLock(dir, () => Promise.resolve("second")),
    ).resolves.toBe("second");
    expect(leftovers()).toEqual([]);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "non-finite timeoutMs %s is a RangeError",
    async (timeoutMs) => {
      await expect(
        withStateLock(dir, () => Promise.resolve(), { timeoutMs }),
      ).rejects.toBeInstanceOf(RangeError);
    },
  );

  test.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "non-finite staleMs %s is a RangeError",
    async (staleMs) => {
      await expect(
        withStateLock(dir, () => Promise.resolve(), { staleMs }),
      ).rejects.toBeInstanceOf(RangeError);
    },
  );
});

describe("release never hangs or follows a swapped lock path", () => {
  test("a FIFO swapped in at the lock path does not hang release", async (ctx) => {
    if (process.platform === "win32") ctx.skip();
    const probe = join(root, "probe-fifo");
    if (spawnSync("mkfifo", [probe]).status !== 0) ctx.skip();
    unlinkSync(probe);
    const run = withStateLock(dir, () => {
      unlinkSync(lockPath);
      spawnSync("mkfifo", [lockPath]);
      return Promise.resolve("done");
    });
    const outcome = await Promise.race([
      run,
      realDelay(3000).then(() => "HUNG"),
    ]);
    if (outcome === "HUNG") {
      // unblock the stuck open so the sandbox can be removed
      closeSync(openSync(lockPath, fsConstants.O_RDWR));
    }
    expect(outcome).toBe("done");
  });

  test("a symlink swapped in at the lock path is not followed on release", async () => {
    const target = join(root, "precious.txt");
    writeFileSync(target, "keep me");
    await withStateLock(dir, () => {
      unlinkSync(lockPath);
      symlinkSync(target, lockPath);
      return Promise.resolve();
    });
    expect(readFileSync(target, "utf8")).toBe("keep me");
  });
});
