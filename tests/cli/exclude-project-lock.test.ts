import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ParsedArgs } from "../../src/cli/args.ts";
import { excludeProject } from "../../src/cli/data-commands.ts";
import type { CommandEnv } from "../../src/cli/env.ts";
import { parseSessionId } from "../../src/internal/schema.ts";
import { defaultState } from "../../src/internal/state-schema.ts";
import { loadState, saveState } from "../../src/internal/store.ts";
import { NOW, SESSION, makeSandbox, type Sandbox } from "./helpers.ts";

const EXISTING = ["/work/a", "/work/b", "/work/c"] as const;

let sb: Sandbox;
beforeEach(async () => {
  sb = makeSandbox();
  await saveState(sb.dir, {
    ...defaultState(NOW),
    excludedProjects: [...EXISTING],
  });
});
afterEach(() => {
  sb.cleanup();
});

function env(): CommandEnv {
  const session = parseSessionId(SESSION);
  if (!session.ok) throw new Error("bad session fixture");
  return { dir: sb.dir, now: NOW, session: session.value, bundled: [] };
}

function args(verb: "add" | "remove", path: string): ParsedArgs {
  return {
    positional: verb,
    values: new Map([["path", path]]),
    booleans: new Set(),
  };
}

/** An identity resolver that records whether the data lock existed at each call. */
function recordingRealpath(): {
  calls: { path: string; lockHeld: boolean }[];
  realpath: (p: string) => string;
} {
  const calls: { path: string; lockHeld: boolean }[] = [];
  return {
    calls,
    realpath: (p) => {
      calls.push({
        path: p,
        lockHeld: existsSync(join(sb.dir, ".state.lock")),
      });
      return p;
    },
  };
}

describe("exclude-project resolves symlinks outside the lock", () => {
  test.each(["add", "remove"] as const)(
    "%s: every realpath call for an entry already stored happens with no lock file",
    async (verb) => {
      const { calls, realpath } = recordingRealpath();
      await excludeProject(args(verb, "/work/new"), env(), {
        platform: "linux",
        realpath,
      });
      for (const entry of EXISTING) {
        const forEntry = calls.filter((c) => c.path === entry);
        expect(forEntry.length).toBeGreaterThan(0);
        expect(forEntry.map((c) => c.lockHeld)).toEqual(
          forEntry.map(() => false),
        );
      }
    },
  );

  test("add still dedupes a legacy spelling of the same project, and remove drops it", async () => {
    const realpath = (p: string): string =>
      p === "/work/link" ? "/work/a" : p;
    const options = { platform: "linux", realpath } as const;
    await excludeProject(args("add", "/work/link"), env(), options);
    expect(
      (await loadState(sb.dir, NOW)).excludedProjects.filter(
        (e) => e === "/work/a" || e === "/work/link",
      ),
    ).toEqual(["/work/a"]);
    await excludeProject(args("remove", "/work/link"), env(), options);
    expect((await loadState(sb.dir, NOW)).excludedProjects).toEqual([
      "/work/b",
      "/work/c",
    ]);
  });
});
