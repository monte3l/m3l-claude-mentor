import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  makeSandbox,
  requireBuilt,
  runDist,
  type Sandbox,
} from "./spawn-helpers.js";

const CLI = "cli/mentor-state.js";

let sb: Sandbox;
beforeAll(() => {
  // `pnpm build` must run first: these tests spawn the compiled CLI.
  requireBuilt(CLI);
});
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

describe("mentor-state CLI entry", () => {
  test("show prints one JSON document and exits 0", () => {
    const r = runDist(CLI, { args: ["show"], dataDir: sb.dir });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(r.stdout) as unknown).not.toThrow();
  });

  test("set-mute on persists and a later get-profile reflects it", () => {
    const set = runDist(CLI, { args: ["set-mute", "on"], dataDir: sb.dir });
    expect(set.status).toBe(0);
    expect(JSON.parse(set.stdout)).toMatchObject({ muted: true });
    const profile = runDist(CLI, { args: ["get-profile"], dataDir: sb.dir });
    expect(profile.status).toBe(0);
    expect(JSON.parse(profile.stdout)).toMatchObject({ muted: true });
  });

  test("an unknown command exits 2 with a usage line on stderr", () => {
    const r = runDist(CLI, { args: ["bogus"], dataDir: sb.dir });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("usage");
  });

  test("a missing argument exits 2", () => {
    const r = runDist(CLI, { args: ["set-mute"], dataDir: sb.dir });
    expect(r.status).toBe(2);
  });

  test("a corrupt state.json is a mentor error: exit 1, nothing on stdout", () => {
    mkdirSync(sb.dir, { recursive: true });
    writeFileSync(join(sb.dir, "state.json"), "{not json");
    const r = runDist(CLI, { args: ["show"], dataDir: sb.dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  test("an unset CLAUDE_PLUGIN_DATA exits 1 with DATA_DIR_UNSET", () => {
    const r = runDist(CLI, { args: ["show"], dataDir: null });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("DATA_DIR_UNSET");
  });

  describe("--data-dir", () => {
    test("works with CLAUDE_PLUGIN_DATA unset", () => {
      const set = runDist(CLI, {
        args: ["--data-dir", sb.dir, "set-mute", "on"],
        dataDir: null,
      });
      expect(set.status).toBe(0);
      const got = runDist(CLI, {
        args: ["--data-dir", sb.dir, "get-profile"],
        dataDir: null,
      });
      expect(JSON.parse(got.stdout)).toMatchObject({ muted: true });
    });

    test("the flag beats CLAUDE_PLUGIN_DATA", () => {
      const other = join(sb.root, "other");
      const set = runDist(CLI, {
        args: ["--data-dir", sb.dir, "set-mute", "on"],
        dataDir: other,
      });
      expect(set.status).toBe(0);
      // the flag's directory holds the change; the env directory does not
      const viaFlag = runDist(CLI, {
        args: ["--data-dir", sb.dir, "get-profile"],
        dataDir: other,
      });
      expect(JSON.parse(viaFlag.stdout)).toMatchObject({ muted: true });
      const viaEnv = runDist(CLI, { args: ["get-profile"], dataDir: other });
      expect(JSON.parse(viaEnv.stdout)).toMatchObject({ muted: false });
    });

    test("a relative path exits 1 with DATA_DIR_INVALID and is not echoed", () => {
      const r = runDist(CLI, {
        args: ["--data-dir", "secret-relative-xyzzy", "show"],
        dataDir: sb.dir,
      });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("DATA_DIR_INVALID");
      expect(r.stderr).not.toContain("xyzzy");
    });

    test("a missing value exits 2 with the usage line", () => {
      const r = runDist(CLI, { args: ["--data-dir"], dataDir: sb.dir });
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("usage: mentor-state [--data-dir");
    });

    test("--data-dir after the command is not consumed (usage error)", () => {
      const r = runDist(CLI, {
        args: ["show", "--data-dir", sb.dir],
        dataDir: sb.dir,
      });
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("usage");
    });
  });
});
