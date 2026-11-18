import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ParsedArgs } from "../../src/cli/args.ts";
import { excludeProject } from "../../src/cli/data-commands.ts";
import type { CommandEnv } from "../../src/cli/env.ts";
import { parseSessionId } from "../../src/internal/schema.ts";
import { defaultState } from "../../src/internal/state-schema.ts";
import { loadState, saveState } from "../../src/internal/store.ts";
import { NOW, SESSION, makeSandbox, type Sandbox } from "./helpers.ts";

let sb: Sandbox;
beforeEach(async () => {
  sb = makeSandbox();
  await saveState(sb.dir, defaultState(NOW));
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

/** A resolver that fails for everything, like a project that is gone. */
const missing = (p: string): string => {
  throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
};

async function stored(): Promise<readonly string[]> {
  return (await loadState(sb.dir, NOW)).excludedProjects;
}

describe("exclude-project with a real symlink and an injected realpath", () => {
  function linkedProject(): { real: string; link: string } {
    const base = realpathSync(sb.root);
    const real = join(base, "proj");
    const link = join(base, "link");
    mkdirSync(real, { recursive: true });
    symlinkSync(real, link);
    return { real, link };
  }

  test("an over-long canonical path stores the normalised given symlink path", async () => {
    const { link } = linkedProject();
    const result = await excludeProject(args("add", `${link}/`), env(), {
      realpath: () => `/${"a".repeat(1100)}`,
    });
    expect(result).toEqual({ excludedProjects: 1 });
    expect(await stored()).toEqual([link]);
  });

  test("control: a short injected real path is what gets stored", async () => {
    const { real, link } = linkedProject();
    await excludeProject(args("add", link), env(), { realpath: () => real });
    expect(await stored()).toEqual([real]);
  });
});

describe("exclude-project case folding", () => {
  // Pinned choice: when a case-variant spelling is added again, the LATEST
  // spelling replaces the earlier entry (add replaces equal entries).
  test.each(["darwin", "win32"] as const)(
    "on %s a case variant is one entry (latest spelling) and removable by either case",
    async (platform) => {
      const options = { platform, realpath: missing };
      await excludeProject(args("add", "/Users/Me/X"), env(), options);
      const result = await excludeProject(
        args("add", "/users/me/x"),
        env(),
        options,
      );
      expect(result).toEqual({ excludedProjects: 1 });
      expect(await stored()).toEqual(["/users/me/x"]);
      await excludeProject(args("remove", "/USERS/me/X"), env(), options);
      expect(await stored()).toEqual([]);
    },
  );

  test("on linux case variants are distinct and remove is case-sensitive", async () => {
    const options = { platform: "linux", realpath: missing } as const;
    await excludeProject(args("add", "/Users/Me/X"), env(), options);
    const result = await excludeProject(
      args("add", "/users/me/x"),
      env(),
      options,
    );
    expect(result).toEqual({ excludedProjects: 2 });
    await excludeProject(args("remove", "/users/me/x"), env(), options);
    expect(await stored()).toEqual(["/Users/Me/X"]);
    await excludeProject(args("remove", "/USERS/ME/X"), env(), options);
    expect(await stored()).toEqual(["/Users/Me/X"]);
  });
});
