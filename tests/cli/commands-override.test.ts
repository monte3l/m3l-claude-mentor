import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseCatalog } from "../../src/internal/catalog.js";
import { saveCatalogFile } from "../../src/internal/store.js";
import {
  put,
  read,
  readJson,
  run,
  runOk,
  makeSandbox,
  type Sandbox,
} from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const CMD = "set-topic-override";
const TOPIC = "plan-mode";

const catalogPath = (): string => join(sb.dir, "catalog.json");
const overrides = (): Record<string, unknown> =>
  (readJson(sb.dir, "catalog.json") as { overrides: Record<string, unknown> })
    .overrides;
const rows = async (): Promise<
  { id: string; enabled: boolean; targetLevel: string; style?: string }[]
> =>
  (
    (await runOk(sb.dir, ["topics"])) as {
      topics: {
        id: string;
        enabled: boolean;
        targetLevel: string;
        style?: string;
      }[];
    }
  ).topics;

describe("set-topic-override happy paths", () => {
  test("--enabled false disables the topic and persists the override", async () => {
    expect(
      await runOk(sb.dir, [CMD, "--topic", TOPIC, "--enabled", "false"]),
    ).toEqual({ topic: TOPIC, override: { enabled: false } });
    expect(overrides()).toEqual({ [TOPIC]: { enabled: false } });
    const plan = (await rows()).find((r) => r.id === TOPIC);
    expect(plan?.enabled).toBe(false);
  });

  test("--enabled true is stored as boolean true", async () => {
    const out = await runOk(sb.dir, [
      CMD,
      "--topic",
      TOPIC,
      "--enabled",
      "true",
    ]);
    expect(out).toEqual({ topic: TOPIC, override: { enabled: true } });
  });

  test("--target sets targetLevel and the merged catalog shows it", async () => {
    const out = await runOk(sb.dir, [
      CMD,
      "--topic",
      TOPIC,
      "--target",
      "Fluent",
    ]);
    expect(out).toEqual({ topic: TOPIC, override: { targetLevel: "Fluent" } });
    expect((await rows()).find((r) => r.id === TOPIC)?.targetLevel).toBe(
      "Fluent",
    );
  });

  test("--style sets the style and the merged catalog shows it", async () => {
    const out = await runOk(sb.dir, [
      CMD,
      "--topic",
      TOPIC,
      "--style",
      "recall-quiz",
    ]);
    expect(out).toEqual({ topic: TOPIC, override: { style: "recall-quiz" } });
    expect((await rows()).find((r) => r.id === TOPIC)?.style).toBe(
      "recall-quiz",
    );
  });

  test("several options in one call are all stored", async () => {
    const out = await runOk(sb.dir, [
      CMD,
      "--topic",
      TOPIC,
      "--enabled",
      "false",
      "--target",
      "Recalled",
      "--style",
      "socratic",
    ]);
    expect(out).toEqual({
      topic: TOPIC,
      override: { enabled: false, targetLevel: "Recalled", style: "socratic" },
    });
  });

  test("fields merge into an existing override for the topic", async () => {
    await runOk(sb.dir, [CMD, "--topic", TOPIC, "--enabled", "false"]);
    const out = await runOk(sb.dir, [
      CMD,
      "--topic",
      TOPIC,
      "--target",
      "Fluent",
    ]);
    expect(out).toEqual({
      topic: TOPIC,
      override: { enabled: false, targetLevel: "Fluent" },
    });
    // a later value for the same field replaces the earlier one
    await runOk(sb.dir, [CMD, "--topic", TOPIC, "--enabled", "true"]);
    expect(overrides()).toEqual({
      [TOPIC]: { enabled: true, targetLevel: "Fluent" },
    });
  });

  test("overrides for other topics are untouched", async () => {
    await runOk(sb.dir, [
      CMD,
      "--topic",
      "context-window",
      "--enabled",
      "false",
    ]);
    await runOk(sb.dir, [CMD, "--topic", TOPIC, "--target", "Fluent"]);
    expect(overrides()).toEqual({
      "context-window": { enabled: false },
      [TOPIC]: { targetLevel: "Fluent" },
    });
  });

  test("a custom topic can be overridden", async () => {
    const custom = parseCatalog([
      {
        id: "my-topic",
        title: "Mine",
        type: "concept",
        dependencies: [],
        keywords: ["mine"],
        targetLevel: "Recalled",
        enabled: true,
      },
    ]);
    if (!custom.ok) throw new Error("fixture invalid");
    await saveCatalogFile(sb.dir, {
      scoring: {},
      user: { overrides: {}, custom: custom.value },
    });
    await runOk(sb.dir, [CMD, "--topic", "my-topic", "--enabled", "false"]);
    expect((await rows()).find((r) => r.id === "my-topic")?.enabled).toBe(
      false,
    );
  });
});

describe("set-topic-override persistence", () => {
  const custom = parseCatalog([
    {
      id: "my-topic",
      title: "Mine",
      type: "concept",
      dependencies: [],
      keywords: ["mine"],
      targetLevel: "Recalled",
      enabled: true,
    },
  ]);

  async function seed(): Promise<void> {
    if (!custom.ok) throw new Error("fixture invalid");
    await saveCatalogFile(sb.dir, {
      scoring: { fluencySessions: 4 },
      user: {
        overrides: { "context-window": { keywords: ["alpha"] } },
        custom: custom.value,
      },
    });
  }

  test("preserves custom topics, scoring and unrelated overrides when setting", async () => {
    await seed();
    await runOk(sb.dir, [CMD, "--topic", TOPIC, "--enabled", "false"]);
    const file = readJson(sb.dir, "catalog.json") as {
      custom: { id: string }[];
      scoring: unknown;
      overrides: unknown;
    };
    expect(file.custom.map((c) => c.id)).toEqual(["my-topic"]);
    expect(file.scoring).toEqual({ fluencySessions: 4 });
    expect(file.overrides).toEqual({
      "context-window": { keywords: ["alpha"] },
      [TOPIC]: { enabled: false },
    });
  });

  test("preserves custom topics, scoring and unrelated overrides on --reset", async () => {
    await seed();
    await runOk(sb.dir, [CMD, "--topic", TOPIC, "--enabled", "false"]);
    await runOk(sb.dir, [CMD, "--topic", TOPIC, "--reset"]);
    const file = readJson(sb.dir, "catalog.json") as {
      custom: { id: string }[];
      scoring: unknown;
      overrides: unknown;
    };
    expect(file.custom.map((c) => c.id)).toEqual(["my-topic"]);
    expect(file.scoring).toEqual({ fluencySessions: 4 });
    expect(file.overrides).toEqual({
      "context-window": { keywords: ["alpha"] },
    });
  });
});

describe("set-topic-override --reset", () => {
  test("removes the override and returns an empty object", async () => {
    await runOk(sb.dir, [
      CMD,
      "--topic",
      TOPIC,
      "--enabled",
      "false",
      "--target",
      "Fluent",
    ]);
    expect(await runOk(sb.dir, [CMD, "--topic", TOPIC, "--reset"])).toEqual({
      topic: TOPIC,
      override: {},
    });
    expect(Object.hasOwn(overrides(), TOPIC)).toBe(false);
    const plan = (await rows()).find((r) => r.id === TOPIC);
    expect(plan).toMatchObject({ enabled: true, targetLevel: "Applied" });
  });

  test("resetting a topic with no override succeeds with {}", async () => {
    expect(await runOk(sb.dir, [CMD, "--topic", TOPIC, "--reset"])).toEqual({
      topic: TOPIC,
      override: {},
    });
  });

  test.each([
    ["--enabled", ["--enabled", "true"]],
    ["--target", ["--target", "Fluent"]],
    ["--style", ["--style", "reference"]],
  ])(
    "--reset together with %s is a usage error and writes nothing",
    async (_n, extra) => {
      const before =
        '{"overrides":{"plan-mode":{"enabled":false}},"custom":[]}';
      put(sb.dir, "catalog.json", before);
      const result = await run(sb.dir, [
        CMD,
        "--topic",
        TOPIC,
        "--reset",
        ...extra,
      ]);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(read(sb.dir, "catalog.json")).toBe(before);
    },
  );
});

describe("set-topic-override usage errors", () => {
  const cases: readonly (readonly [string, readonly string[]])[] = [
    ["no arguments", [CMD]],
    ["only --topic (no option)", [CMD, "--topic", TOPIC]],
    ["no --topic", [CMD, "--enabled", "false"]],
    ["--reset without --topic", [CMD, "--reset"]],
    ["a missing --topic value", [CMD, "--topic"]],
    ["a malformed topic id", [CMD, "--topic", "Bad Id!", "--enabled", "true"]],
    [
      "an unknown topic",
      [CMD, "--topic", "no-such-topic", "--enabled", "true"],
    ],
    [
      "an unknown topic with --reset",
      [CMD, "--topic", "no-such-topic", "--reset"],
    ],
    [
      "a repeated --enabled",
      [CMD, "--topic", TOPIC, "--enabled", "true", "--enabled", "false"],
    ],
    [
      "a repeated --topic",
      [CMD, "--topic", TOPIC, "--topic", TOPIC, "--enabled", "true"],
    ],
    ["a repeated --reset", [CMD, "--topic", TOPIC, "--reset", "--reset"]],
    [
      "an unknown flag",
      [CMD, "--topic", TOPIC, "--enabled", "true", "--nope", "1"],
    ],
    [
      "a stray positional",
      [CMD, "--topic", TOPIC, "--enabled", "true", "extra"],
    ],
    ["--enabled yes", [CMD, "--topic", TOPIC, "--enabled", "yes"]],
    ["--enabled TRUE", [CMD, "--topic", TOPIC, "--enabled", "TRUE"]],
    ["--enabled 1", [CMD, "--topic", TOPIC, "--enabled", "1"]],
    ["an empty --enabled", [CMD, "--topic", TOPIC, "--enabled", ""]],
    ["an unknown level", [CMD, "--topic", TOPIC, "--target", "Master"]],
    ["a lowercase level", [CMD, "--topic", TOPIC, "--target", "fluent"]],
    ["an unknown style", [CMD, "--topic", TOPIC, "--style", "lecture"]],
    [
      "a valid option beside a bad one",
      [CMD, "--topic", TOPIC, "--enabled", "false", "--target", "Master"],
    ],
  ];

  test.each(cases)(
    "%s -> exit 2, fixed usage line, nothing written",
    async (_name, argv) => {
      const result = await run(sb.dir, argv);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(
        /^usage: mentor-state set-topic-override [^\n]+\n$/,
      );
      expect(existsSync(catalogPath())).toBe(false);
    },
  );

  test("a rejected call leaves an existing catalog.json byte-identical", async () => {
    const before = '{"overrides":{},"custom":[],"scoring":{"halfLifeDays":30}}';
    put(sb.dir, "catalog.json", before);
    await run(sb.dir, [
      CMD,
      "--topic",
      TOPIC,
      "--enabled",
      "false",
      "--style",
      "lecture",
    ]);
    expect(read(sb.dir, "catalog.json")).toBe(before);
  });

  test("does not echo rejected argument values", async () => {
    for (const argv of [
      [CMD, "--topic", "secret-topic-xyzzy", "--enabled", "true"],
      [CMD, "--topic", TOPIC, "--style", "SECRET-STYLE-xyzzy"],
      [CMD, "--topic", TOPIC, "--target", "SECRET-LEVEL-xyzzy"],
      [CMD, "--topic", TOPIC, "--enabled", "SECRET-BOOL-xyzzy"],
    ]) {
      const result = await run(sb.dir, argv);
      expect(result.stderr).not.toMatch(/secret|xyzzy/i);
    }
  });
});

describe("set-topic-override catalog failures", () => {
  test("a catalog.json that does not merge exits 1 and is left unchanged", async () => {
    const before =
      '{"overrides":{"no-such-topic":{"enabled":false}},"custom":[]}';
    put(sb.dir, "catalog.json", before);
    const result = await run(sb.dir, [
      CMD,
      "--topic",
      TOPIC,
      "--enabled",
      "false",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(read(sb.dir, "catalog.json")).toBe(before);
  });

  test("a corrupt catalog.json exits 1, is left unchanged and is not echoed", async () => {
    const before = "{ SECRET-xyzzy";
    put(sb.dir, "catalog.json", before);
    const result = await run(sb.dir, [
      CMD,
      "--topic",
      TOPIC,
      "--enabled",
      "false",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("SECRET-xyzzy");
    expect(read(sb.dir, "catalog.json")).toBe(before);
  });
});
