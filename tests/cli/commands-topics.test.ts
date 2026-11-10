import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parseCatalog } from "../../src/internal/catalog.js";
import { saveCatalogFile, saveProfile } from "../../src/internal/store.js";
import { defaultProfile } from "../../src/internal/state-schema.js";
import { put, read, run, runOk, makeSandbox, type Sandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

interface TopicRow {
  id: string;
  title: string;
  type: string;
  targetLevel: string;
  style?: string;
  enabled: boolean;
  dependencies: string[];
  keywords: string[];
  level: string;
  introduced: boolean;
  muted: boolean;
}

const topics = async (): Promise<TopicRow[]> =>
  ((await runOk(sb.dir, ["topics"])) as { topics: TopicRow[] }).topics;

function customEntries(): ReturnType<typeof parseCatalog> {
  return parseCatalog([
    {
      id: "my-topic",
      title: "My topic",
      type: "concept",
      dependencies: [],
      keywords: ["mine"],
      targetLevel: "Recalled",
      enabled: true,
      style: "reference",
    },
  ]);
}

describe("topics", () => {
  test("lists the bundled catalog in order with Unseen defaults", async () => {
    expect(await runOk(sb.dir, ["topics"])).toEqual({
      topics: [
        {
          id: "context-window",
          title: "The context window",
          type: "concept",
          targetLevel: "Understood",
          enabled: true,
          dependencies: [],
          keywords: ["context"],
          level: "Unseen",
          introduced: false,
          muted: false,
        },
        {
          id: "plan-mode",
          title: "Plan mode",
          type: "feature",
          targetLevel: "Applied",
          enabled: true,
          dependencies: [],
          keywords: ["plan"],
          level: "Unseen",
          introduced: false,
          muted: false,
        },
      ],
    });
  });

  test("omits style when the entry has none", async () => {
    const [first] = await topics();
    expect(first).toBeDefined();
    expect(Object.hasOwn(first as object, "style")).toBe(false);
  });

  test("an absent bundled catalog yields an empty list", async () => {
    expect(await runOk(sb.dir, ["topics"], { bundled: [] })).toEqual({
      topics: [],
    });
  });

  test("joins the stored level and introduced flag", async () => {
    await saveProfile(sb.dir, {
      ...defaultProfile(),
      topics: {
        "plan-mode": {
          introduced: true,
          level: "Applied",
          lastPassAt: null,
          passes: 0,
        },
      },
    });
    const rows = await topics();
    expect(rows.map((r) => [r.id, r.level, r.introduced])).toEqual([
      ["context-window", "Unseen", false],
      ["plan-mode", "Applied", true],
    ]);
  });

  test("reports muted from the state's mutedTopics only", async () => {
    await runOk(sb.dir, ["set-topic-mute", "on", "--topic", "plan-mode"]);
    const rows = await topics();
    expect(rows.map((r) => [r.id, r.muted])).toEqual([
      ["context-window", false],
      ["plan-mode", true],
    ]);
  });

  test("appends custom topics after the bundled ones, with their style", async () => {
    const custom = customEntries();
    if (!custom.ok) throw new Error("fixture invalid");
    await saveCatalogFile(sb.dir, {
      scoring: {},
      user: { overrides: {}, custom: custom.value },
    });
    const rows = await topics();
    expect(rows.map((r) => r.id)).toEqual([
      "context-window",
      "plan-mode",
      "my-topic",
    ]);
    expect(rows[2]).toMatchObject({
      title: "My topic",
      type: "concept",
      targetLevel: "Recalled",
      style: "reference",
      keywords: ["mine"],
      level: "Unseen",
    });
  });

  test("honours overrides: disabled entries stay listed with enabled false", async () => {
    await saveCatalogFile(sb.dir, {
      scoring: {},
      user: {
        overrides: {
          "plan-mode": {
            enabled: false,
            targetLevel: "Fluent",
            style: "socratic",
            keywords: ["alpha", "beta"],
          },
        },
        custom: [],
      },
    });
    const rows = await topics();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "context-window", enabled: true });
    expect(rows[1]).toMatchObject({
      id: "plan-mode",
      enabled: false,
      targetLevel: "Fluent",
      style: "socratic",
      keywords: ["alpha", "beta"],
    });
  });

  test("does not modify catalog.json", async () => {
    const text = '{"overrides":{},"custom":[]}';
    put(sb.dir, "catalog.json", text);
    await runOk(sb.dir, ["topics"]);
    expect(read(sb.dir, "catalog.json")).toBe(text);
  });

  test.each([
    ["a positional", ["topics", "x"]],
    ["a flag", ["topics", "--topic", "plan-mode"]],
    ["a boolean-looking flag", ["topics", "--all"]],
  ])("%s -> exit 2 with a fixed usage line", async (_name, argv) => {
    const result = await run(sb.dir, argv);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^usage: mentor-state topics\n$/);
  });

  test("a catalog.json that does not merge exits 1 with VALIDATION_FAILED", async () => {
    await saveCatalogFile(sb.dir, {
      scoring: {},
      user: { overrides: { "no-such-topic": { enabled: false } }, custom: [] },
    });
    const result = await run(sb.dir, ["topics"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^VALIDATION_FAILED: /);
    expect(result.stderr).not.toContain("no-such-topic");
  });

  test("a corrupt catalog.json exits 1 and does not echo its content", async () => {
    put(sb.dir, "catalog.json", "{ SECRET-xyzzy");
    const result = await run(sb.dir, ["topics"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("SECRET-xyzzy");
  });
});
