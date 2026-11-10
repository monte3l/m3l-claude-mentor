import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { run, runOk, makeSandbox, type Sandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const version = async (): Promise<unknown> =>
  (
    (await runOk(sb.dir, ["get-profile"])) as {
      lastChangelogVersion: unknown;
    }
  ).lastChangelogVersion;

describe("get-profile lastChangelogVersion", () => {
  test("is null when nothing was recorded", async () => {
    expect(await version()).toBeNull();
  });
});

describe("set-changelog-version", () => {
  test("records the version and get-profile reports it", async () => {
    expect(
      await runOk(sb.dir, ["set-changelog-version", "--version", "1.2.3"]),
    ).toEqual({ lastChangelogVersion: "1.2.3" });
    expect(await version()).toBe("1.2.3");
  });

  test("a later call replaces the earlier version", async () => {
    await runOk(sb.dir, ["set-changelog-version", "--version", "1.0.0"]);
    await runOk(sb.dir, ["set-changelog-version", "--version", "2.0.0"]);
    expect(await version()).toBe("2.0.0");
  });

  test("leaves the other state fields untouched", async () => {
    await runOk(sb.dir, ["set-mute", "on"]);
    await runOk(sb.dir, ["set-topic-mute", "on", "--topic", "plan-mode"]);
    await runOk(sb.dir, ["set-changelog-version", "--version", "1.0.0"]);
    const out = (await runOk(sb.dir, ["get-profile"])) as {
      muted: boolean;
      mutedTopics: string[];
    };
    expect(out.muted).toBe(true);
    expect(out.mutedTopics).toEqual(["plan-mode"]);
  });

  test.each([
    ["a single character", "1"],
    ["a semver with prerelease and build", "1.2.3-rc.1+build.5"],
    ["letters and digits", "v2Beta"],
    ["exactly 64 characters", "a".repeat(64)],
  ])("accepts %s", async (_name, value) => {
    const out = await runOk(sb.dir, [
      "set-changelog-version",
      "--version",
      value,
    ]);
    expect(out).toEqual({ lastChangelogVersion: value });
    expect(await version()).toBe(value);
  });

  test.each([
    ["65 characters", "a".repeat(65)],
    ["empty", ""],
    ["a space", "1.2 3"],
    ["a slash", "1/2"],
    ["an underscore", "1_2"],
    ["a non-ASCII letter", "1.2.é"],
    ["a trailing newline", "1.2.3\n"],
  ])(
    "rejects %s with a usage-style failure and keeps the old value",
    async (_name, value) => {
      await runOk(sb.dir, ["set-changelog-version", "--version", "1.0.0"]);
      const result = await run(sb.dir, [
        "set-changelog-version",
        "--version",
        value,
      ]);
      expect([1, 2]).toContain(result.exitCode);
      expect(result.stdout).toBe("");
      expect(result.stderr.trimEnd()).not.toContain("\n");
      expect(await version()).toBe("1.0.0");
    },
  );

  test("an invalid version exits 2 with the fixed usage line", async () => {
    const result = await run(sb.dir, [
      "set-changelog-version",
      "--version",
      "bad version",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^usage: mentor-state set-changelog-version/);
  });

  test.each([
    ["no flag", ["set-changelog-version"]],
    ["a missing value", ["set-changelog-version", "--version"]],
    [
      "a repeated flag",
      ["set-changelog-version", "--version", "1", "--version", "2"],
    ],
    [
      "an unknown flag",
      ["set-changelog-version", "--version", "1", "--x", "y"],
    ],
    ["a stray positional", ["set-changelog-version", "1.0.0"]],
  ])("%s -> exit 2 with a fixed usage line", async (_name, argv) => {
    const result = await run(sb.dir, argv);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^usage: [^\n]+\n$/);
    expect(await version()).toBeNull();
  });

  test("does not echo the rejected argument", async () => {
    const result = await run(sb.dir, [
      "set-changelog-version",
      "--version",
      "SECRET xyzzy!",
    ]);
    expect(result.stderr).not.toContain("SECRET");
    expect(result.stderr).not.toContain("xyzzy");
  });

  test("is listed in the general usage line", async () => {
    const result = await run(sb.dir, ["no-such-command"]);
    expect(result.stderr).toContain("set-changelog-version");
    expect(result.stderr).toContain("set-topic-override");
    expect(result.stderr).toContain("topics");
  });
});
