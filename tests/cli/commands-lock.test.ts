import {
  existsSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { exportBundleToFile } from "../../src/internal/export.ts";
import { EMPTY_CATALOG_FILE } from "../../src/internal/catalog-file.ts";
import type { LockOptions } from "../../src/internal/lock.ts";
import {
  defaultProfile,
  defaultState,
} from "../../src/internal/state-schema.ts";
import {
  saveCatalogFile,
  saveGoals,
  saveProfile,
  saveState,
} from "../../src/internal/store.ts";
import {
  NOW,
  makeSandbox,
  run,
  runOk,
  seedEvidence,
  type Sandbox,
} from "./helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const LOCK = ".state.lock";
const FOREIGN = JSON.stringify({
  v: 1,
  pid: 424242,
  host: "foreign-host-xyz",
  token: "foreign-token",
  createdAt: 0,
});

/** Injected lock options: a fake clock that `sleep` advances, so nothing really waits. */
function fakeLock(): { lock: LockOptions; sleeps: number[] } {
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

async function seedAll(): Promise<void> {
  await saveState(sb.dir, defaultState(NOW));
  await saveProfile(sb.dir, defaultProfile());
  await saveGoals(sb.dir, "old goals");
  await saveCatalogFile(sb.dir, EMPTY_CATALOG_FILE);
  await seedEvidence(sb.dir, "plan-mode", "quiz", "positive", 1);
}

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(sb.dir)) {
    if (name.startsWith(LOCK)) continue;
    out[name] = readFileSync(join(sb.dir, name), "utf8");
  }
  return out;
}

function seedForeignLock(): void {
  writeFileSync(join(sb.dir, LOCK), FOREIGN);
}

function lockFiles(): string[] {
  return readdirSync(sb.dir).filter((n) => n.startsWith(LOCK));
}

const WRITERS: readonly (readonly [string, readonly string[]])[] = [
  ["set-mute", ["set-mute", "on"]],
  ["set-topic-mute", ["set-topic-mute", "on", "--topic", "plan-mode"]],
  [
    "exclude-project",
    ["exclude-project", "add", "--path", "/work/some-project"],
  ],
  ["set-changelog-version", ["set-changelog-version", "--version", "2.1.0"]],
  [
    "record-evidence",
    [
      "record-evidence",
      "--topic",
      "plan-mode",
      "--channel",
      "quiz",
      "--result",
      "positive",
    ],
  ],
  ["set-goals", ["set-goals", "--text", "new goals"]],
  [
    "record-batch",
    ["record-batch", "--topic", "plan-mode", "--events", "quiz:positive"],
  ],
  ["recompute", ["recompute", "--topic", "plan-mode"]],
  ["introduce", ["introduce", "--topic", "plan-mode"]],
  ["reset-topic", ["reset-topic", "--topic", "plan-mode"]],
  ["record-pass", ["record-pass", "--topic", "plan-mode", "--result", "pass"]],
  [
    "set-topic-override",
    ["set-topic-override", "--topic", "plan-mode", "--enabled", "false"],
  ],
  ["import", ["import", "--from", "__BUNDLE__", "--replace"]],
  ["purge", ["purge", "--confirm"]],
];

/** Replaces the __BUNDLE__ placeholder with a real bundle file outside the data dir. */
async function prepare(argv: readonly string[]): Promise<readonly string[]> {
  const bundle = join(sb.root, "bundle.json");
  await exportBundleToFile(join(sb.root, "bundle-source"), NOW, bundle);
  return argv.map((a) => (a === "__BUNDLE__" ? bundle : a));
}

describe.each(WRITERS)("writer %s", (_name, rawArgv) => {
  test("a fresh foreign lock gives LOCK_TIMEOUT (exit 1) and writes nothing", async () => {
    const argv = await prepare(rawArgv);
    await seedAll();
    seedForeignLock();
    const before = snapshot();
    const { lock, sleeps } = fakeLock();
    const result = await run(sb.dir, argv, { lock });
    expect(result.stderr).toMatch(/^LOCK_TIMEOUT: [^\n]+\n$/);
    expect(result.stderr).not.toContain("424242");
    expect(result.stderr).not.toContain("foreign-host-xyz");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(sleeps.length).toBeGreaterThan(0);
    expect(snapshot()).toEqual(before);
    expect(readFileSync(join(sb.dir, LOCK), "utf8")).toBe(FOREIGN);
  });

  test("with no lock present it succeeds and leaves no lock file", async () => {
    const argv = await prepare(rawArgv);
    await seedAll();
    const { lock } = fakeLock();
    const result = await run(sb.dir, argv, { lock });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(lockFiles()).toEqual([]);
  });
});

describe("the CLI default lock timeout", () => {
  test("is about 6 s (CLI_LOCK_TIMEOUT_MS), not the hooks' 2 s", async () => {
    await seedAll();
    seedForeignLock();
    // staleMs is raised so the fake 6 s cannot age the foreign lock into a stale one.
    let t = Date.now();
    const start = t;
    const result = await run(sb.dir, ["set-mute", "on"], {
      lock: {
        staleMs: 600_000,
        now: () => t,
        sleep: (ms: number) => {
          t += ms;
          return Promise.resolve();
        },
      },
    });
    expect(result.stderr).toMatch(/^LOCK_TIMEOUT: /);
    expect(result.exitCode).toBe(1);
    expect(t - start).toBeGreaterThan(5000);
    expect(t - start).toBeGreaterThanOrEqual(6000);
    expect(t - start).toBeLessThan(6300);
  });
});

describe("read-only commands take no lock", () => {
  test.each([
    ["show", ["show"]],
    ["get-profile", ["get-profile"]],
    ["topics", ["topics"]],
    ["get-goals", ["get-goals"]],
    ["export", ["export", "--to", "__EXPORT__"]],
  ] as const)("%s succeeds past a fresh foreign lock", async (_name, argv) => {
    await seedAll();
    seedForeignLock();
    const { lock, sleeps } = fakeLock();
    const args = argv.map((a) =>
      a === "__EXPORT__" ? join(sb.root, "bundle.json") : a,
    );
    const result = await run(sb.dir, args, { lock });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(sleeps).toEqual([]);
    expect(readFileSync(join(sb.dir, LOCK), "utf8")).toBe(FOREIGN);
  });
});

describe("record-batch validates before it locks", () => {
  test.each([
    ["a missing --events", ["record-batch", "--topic", "plan-mode"]],
    [
      "an unknown topic",
      ["record-batch", "--topic", "no-such-topic", "--events", "quiz:positive"],
    ],
    [
      "a malformed event",
      ["record-batch", "--topic", "plan-mode", "--events", "bogus"],
    ],
  ])("%s is a usage error and never touches the lock", async (_n, argv) => {
    await seedAll();
    seedForeignLock();
    const before = snapshot();
    let slept = 0;
    const result = await run(sb.dir, argv, {
      lock: {
        timeoutMs: 50,
        sleep: () => {
          slept += 1;
          return Promise.reject(new Error("must not wait for the lock"));
        },
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^usage: /);
    expect(slept).toBe(0);
    expect(snapshot()).toEqual(before);
    expect(readFileSync(join(sb.dir, LOCK), "utf8")).toBe(FOREIGN);
  });
});

describe("set-topic-override reads the catalog inside the lock", () => {
  test("concurrent overrides on different topics both land", async () => {
    // Repeated so an unlocked or outside-the-lock load is very likely caught.
    for (let round = 0; round < 8; round += 1) {
      const dir = join(sb.root, `round-${String(round)}`);
      const lock: LockOptions = {
        timeoutMs: 30_000,
        sleep: () =>
          new Promise<void>((r) => {
            setTimeout(r, 1);
          }),
      };
      const [a, b] = await Promise.all([
        run(
          dir,
          ["set-topic-override", "--topic", "plan-mode", "--enabled", "false"],
          { lock },
        ),
        run(
          dir,
          [
            "set-topic-override",
            "--topic",
            "context-window",
            "--enabled",
            "false",
          ],
          { lock },
        ),
      ]);
      expect([a.exitCode, b.exitCode]).toEqual([0, 0]);
      const file = JSON.parse(
        readFileSync(join(dir, "catalog.json"), "utf8"),
      ) as { overrides: Record<string, unknown> };
      expect(Object.keys(file.overrides).sort()).toEqual([
        "context-window",
        "plan-mode",
      ]);
      expect(existsSync(join(dir, LOCK))).toBe(false);
    }
  });
});

describe("a stale foreign lock does not block a CLI writer", () => {
  test("an old lock is broken and the command succeeds", async () => {
    await seedAll();
    seedForeignLock();
    const old = (Date.now() - 60_000) / 1000;
    utimesSync(join(sb.dir, LOCK), old, old);
    const { lock, sleeps } = fakeLock();
    await expect(runOk(sb.dir, ["set-mute", "on"], { lock })).resolves.toEqual({
      muted: true,
    });
    expect(sleeps).toEqual([]);
    expect(lockFiles()).toEqual([]);
  });
});
