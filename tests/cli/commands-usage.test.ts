import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runCommand } from "../../src/cli/commands.js";
import {
  ctxFor,
  makeSandbox,
  NOW,
  put,
  read,
  run,
  type Sandbox,
} from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const usageCases: readonly (readonly [string, readonly string[]])[] = [
  ["empty argv", []],
  ["unknown command", ["frobnicate"]],
  ["extra argument to show", ["show", "extra"]],
  ["unknown flag", ["get-profile", "--nope", "x"]],
  ["missing --topic", ["introduce"]],
  ["flag without value", ["introduce", "--topic"]],
  [
    "repeated flag",
    ["introduce", "--topic", "plan-mode", "--topic", "context-window"],
  ],
  ["invalid topic id", ["introduce", "--topic", "Not A Topic"]],
  ["unknown topic", ["introduce", "--topic", "no-such-topic"]],
  [
    "invalid channel",
    [
      "record-evidence",
      "--topic",
      "plan-mode",
      "--channel",
      "telepathy",
      "--result",
      "positive",
    ],
  ],
  [
    "invalid result",
    [
      "record-evidence",
      "--topic",
      "plan-mode",
      "--channel",
      "quiz",
      "--result",
      "maybe",
    ],
  ],
  [
    "missing --channel",
    ["record-evidence", "--topic", "plan-mode", "--result", "positive"],
  ],
  [
    "invalid pass result",
    ["record-pass", "--topic", "plan-mode", "--result", "positive"],
  ],
  [
    "invalid claim level",
    ["recompute", "--topic", "plan-mode", "--claim", "Wizard"],
  ],
  ["set-mute without on/off", ["set-mute"]],
  ["set-mute bad value", ["set-mute", "maybe"]],
  ["set-mute extra argument", ["set-mute", "on", "off"]],
  [
    "set-topic-mute on unknown topic",
    ["set-topic-mute", "on", "--topic", "no-such-topic"],
  ],
  ["set-topic-mute without topic", ["set-topic-mute", "on"]],
  [
    "exclude-project bad verb",
    ["exclude-project", "toggle", "--path", "/work/p"],
  ],
  [
    "exclude-project relative path",
    ["exclude-project", "add", "--path", "relative/p"],
  ],
  ["exclude-project missing path", ["exclude-project", "add"]],
  ["set-goals missing text", ["set-goals"]],
  ["export missing --to", ["export"]],
  ["export relative --to", ["export", "--to", "relative/out.json"]],
  ["import missing --from", ["import", "--replace"]],
  [
    "import relative --from",
    ["import", "--from", "relative/in.json", "--replace"],
  ],
  ["purge with positional", ["purge", "--confirm", "extra"]],
];

describe("usage errors", () => {
  test.each(usageCases)(
    "%s -> exit 2 with a fixed usage line",
    async (_name, argv) => {
      const result = await run(sb.dir, argv);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/^usage: [^\n]+\n$/);
    },
  );

  test("a usage error writes nothing to the data directory", async () => {
    await run(sb.dir, ["introduce", "--topic", "no-such-topic"]);
    await run(sb.dir, ["frobnicate"]);
    expect(existsSync(join(sb.dir, "profile.json"))).toBe(false);
    expect(existsSync(join(sb.dir, "state.json"))).toBe(false);
  });
});

describe("no echo of argument values", () => {
  test.each([
    ["unknown command", ["TOPSECRET-cmd"]],
    ["unknown topic", ["introduce", "--topic", "topsecret-topic"]],
    ["invalid topic", ["introduce", "--topic", "TOPSECRET topic!"]],
    [
      "invalid channel",
      [
        "record-evidence",
        "--topic",
        "plan-mode",
        "--channel",
        "TOPSECRET",
        "--result",
        "positive",
      ],
    ],
    [
      "invalid result",
      ["record-pass", "--topic", "plan-mode", "--result", "TOPSECRET"],
    ],
    [
      "invalid claim",
      ["recompute", "--topic", "plan-mode", "--claim", "TOPSECRET"],
    ],
    ["relative path", ["exclude-project", "add", "--path", "TOPSECRET/rel"]],
    ["bad on/off", ["set-mute", "TOPSECRET"]],
    ["extra positional", ["show", "TOPSECRET"]],
  ] as const)("%s", async (_name, argv) => {
    const result = await run(sb.dir, argv);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toLowerCase()).not.toContain("topsecret");
    expect(result.stdout.toLowerCase()).not.toContain("topsecret");
  });

  test("a MentorStateError message carries neither the argument nor file content", async () => {
    put(sb.dir, "state.json", "TOPSECRET-file-content {");
    const result = await run(sb.dir, ["set-mute", "on"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).not.toContain("topsecret");
  });
});

describe("MentorStateError mapping", () => {
  test("corrupt state.json -> exit 1 with the code first in stderr", async () => {
    put(sb.dir, "state.json", "{ not json");
    const result = await run(sb.dir, ["set-mute", "on"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^PARSE_FAILED: [^\n]+\n$/);
    expect(read(sb.dir, "state.json")).toBe("{ not json");
  });

  test("an invalid data dir -> exit 1 DATA_DIR_INVALID", async () => {
    const result = await run("relative/dir", ["show"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^DATA_DIR_INVALID: /);
  });

  test("a schema-invalid profile.json -> exit 1 with an upper-case code", async () => {
    put(sb.dir, "profile.json", JSON.stringify({ schemaVersion: 99 }));
    const result = await run(sb.dir, ["get-profile"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^[A-Z_]+: [^\n]+\n$/);
  });
});

describe("context validation", () => {
  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "now=%s rejects with RangeError",
    async (now) => {
      await expect(
        runCommand(["show"], ctxFor(sb.dir, { now })),
      ).rejects.toBeInstanceOf(RangeError);
    },
  );

  test.each(["", "has space", "bad/slash", "x".repeat(129)])(
    "session %j rejects with RangeError",
    async (session) => {
      await expect(
        runCommand(["show"], ctxFor(sb.dir, { session })),
      ).rejects.toBeInstanceOf(RangeError);
    },
  );

  test("now=0 is accepted", async () => {
    const result = await runCommand(["show"], ctxFor(sb.dir, { now: 0 }));
    expect(result.exitCode).toBe(0);
  });
});

describe("unexpected errors", () => {
  test("a non-mentor, non-argument error is rethrown, not mapped", async () => {
    const poisoned = [
      {
        get id(): string {
          throw new Error("boom-unexpected");
        },
      },
    ] as unknown as NonNullable<ReturnType<typeof ctxFor>["bundled"]>;
    await expect(
      runCommand(
        ["get-profile"],
        ctxFor(sb.dir, { bundled: poisoned, now: NOW }),
      ),
    ).rejects.toThrow("boom-unexpected");
  });
});
