import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { describeData } from "../../src/internal/purge.js";
import {
  defaultProfile,
  type Profile,
} from "../../src/internal/state-schema.js";
import { saveProfile } from "../../src/internal/store.js";
import {
  NOW,
  makeSandbox,
  put,
  read,
  readJson,
  run,
  runOk,
  type Sandbox,
} from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

async function seedProfile(topics: Profile["topics"]): Promise<void> {
  await saveProfile(sb.dir, { ...defaultProfile(), topics });
}
const profileTopic = (id: string): unknown =>
  (readJson(sb.dir, "profile.json") as { topics: Record<string, unknown> })
    .topics[id];
const stateJson = (): {
  muted: boolean;
  mutedTopics: string[];
  excludedProjects: string[];
} => readJson(sb.dir, "state.json") as never;

describe("show", () => {
  test("prints the DataSummary", async () => {
    put(sb.dir, "goals.md", "hi");
    const out = await runOk(sb.dir, ["show"]);
    expect(out).toEqual(
      JSON.parse(JSON.stringify(await describeData(sb.dir, NOW))),
    );
  });
});

describe("record-evidence", () => {
  test("appends one event with at=now and the context session", async () => {
    const out = await runOk(sb.dir, [
      "record-evidence",
      "--topic",
      "plan-mode",
      "--channel",
      "quiz",
      "--result",
      "positive",
    ]);
    expect(out).toEqual({ recorded: true });
    const lines = read(sb.dir, "evidence.jsonl").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      channel: "quiz",
      topic: "plan-mode",
      result: "positive",
      at: NOW,
      session: "sess-1",
    });
  });

  test("flag order is free and self-report negative is allowed", async () => {
    const out = await runOk(
      sb.dir,
      [
        "record-evidence",
        "--result",
        "negative",
        "--channel",
        "self-report",
        "--topic",
        "plan-mode",
      ],
      { session: "other_2" },
    );
    expect(out).toEqual({ recorded: true });
    expect(JSON.parse(read(sb.dir, "evidence.jsonl").trim())).toMatchObject({
      channel: "self-report",
      result: "negative",
      session: "other_2",
    });
  });
});

describe("introduce", () => {
  test("creates the topic at Introduced when absent", async () => {
    const out = await runOk(sb.dir, ["introduce", "--topic", "plan-mode"]);
    expect(out).toEqual({ topic: "plan-mode", level: "Introduced" });
    expect(profileTopic("plan-mode")).toMatchObject({
      introduced: true,
      level: "Introduced",
    });
  });

  test("keeps an existing higher level", async () => {
    await seedProfile({
      "plan-mode": {
        introduced: false,
        level: "Applied",
        lastPassAt: null,
        passes: 0,
      },
    });
    const out = await runOk(sb.dir, ["introduce", "--topic", "plan-mode"]);
    expect(out).toEqual({ topic: "plan-mode", level: "Applied" });
    expect(profileTopic("plan-mode")).toMatchObject({
      introduced: true,
      level: "Applied",
    });
  });
});

describe("record-pass", () => {
  const seed = (passes: number): Promise<void> =>
    seedProfile({
      "plan-mode": {
        introduced: true,
        level: "Recalled",
        lastPassAt: 5,
        passes,
      },
    });

  test("pass increments passes and stamps lastPassAt = now", async () => {
    await seed(2);
    const out = await runOk(sb.dir, [
      "record-pass",
      "--topic",
      "plan-mode",
      "--result",
      "pass",
    ]);
    expect(out).toEqual({ topic: "plan-mode", passes: 3 });
    expect(profileTopic("plan-mode")).toMatchObject({
      passes: 3,
      lastPassAt: NOW,
    });
  });

  test("fail resets passes to 0 and leaves lastPassAt alone", async () => {
    await seed(4);
    const out = await runOk(sb.dir, [
      "record-pass",
      "--topic",
      "plan-mode",
      "--result",
      "fail",
    ]);
    expect(out).toEqual({ topic: "plan-mode", passes: 0 });
    expect(profileTopic("plan-mode")).toMatchObject({
      passes: 0,
      lastPassAt: 5,
    });
  });
});

describe("set-mute", () => {
  test.each([
    ["on", true],
    ["off", false],
  ] as const)("%s sets muted=%s", async (arg, muted) => {
    const out = await runOk(sb.dir, ["set-mute", arg]);
    expect(out).toEqual({ muted });
    expect(stateJson().muted).toBe(muted);
  });
});

describe("set-topic-mute", () => {
  test("on adds once (deduped), off removes", async () => {
    expect(
      await runOk(sb.dir, ["set-topic-mute", "on", "--topic", "plan-mode"]),
    ).toEqual({ topic: "plan-mode", muted: true });
    await runOk(sb.dir, ["set-topic-mute", "on", "--topic", "plan-mode"]);
    expect(stateJson().mutedTopics).toEqual(["plan-mode"]);
    expect(
      await runOk(sb.dir, ["set-topic-mute", "off", "--topic", "plan-mode"]),
    ).toEqual({ topic: "plan-mode", muted: false });
    expect(stateJson().mutedTopics).toEqual([]);
  });

  test("off accepts a well-formed topic id absent from the catalog", async () => {
    put(
      sb.dir,
      "state.json",
      JSON.stringify({
        ...JSON.parse(JSON.stringify(await seedState())),
        mutedTopics: ["gone-topic"],
      }),
    );
    const out = await runOk(sb.dir, [
      "set-topic-mute",
      "off",
      "--topic",
      "gone-topic",
    ]);
    expect(out).toEqual({ topic: "gone-topic", muted: false });
    expect(stateJson().mutedTopics).toEqual([]);
  });

  test("off still rejects a malformed topic id with exit 2", async () => {
    const result = await run(sb.dir, [
      "set-topic-mute",
      "off",
      "--topic",
      "Bad Id",
    ]);
    expect(result.exitCode).toBe(2);
  });
});

async function seedState(): Promise<unknown> {
  await runOk(sb.dir, ["set-mute", "off"]);
  return readJson(sb.dir, "state.json");
}

describe("exclude-project", () => {
  test("add is deduped and reports the count; remove drops it", async () => {
    expect(
      await runOk(sb.dir, ["exclude-project", "add", "--path", "/work/a"]),
    ).toEqual({ excludedProjects: 1 });
    expect(
      await runOk(sb.dir, ["exclude-project", "add", "--path", "/work/a"]),
    ).toEqual({ excludedProjects: 1 });
    expect(
      await runOk(sb.dir, ["exclude-project", "add", "--path", "/work/b"]),
    ).toEqual({ excludedProjects: 2 });
    expect(
      await runOk(sb.dir, ["exclude-project", "remove", "--path", "/work/a"]),
    ).toEqual({ excludedProjects: 1 });
    expect(stateJson().excludedProjects).toEqual(["/work/b"]);
  });
});

describe("goals", () => {
  test("get-goals on a fresh dir returns the empty string", async () => {
    expect(await runOk(sb.dir, ["get-goals"])).toEqual({ goals: "" });
  });

  test("set-goals stores the text and reports UTF-8 bytes; get-goals reads it back", async () => {
    const out = await runOk(sb.dir, ["set-goals", "--text", "héllo"]);
    expect(out).toEqual({ bytes: 6 });
    expect(read(sb.dir, "goals.md")).toBe("héllo");
    expect(await runOk(sb.dir, ["get-goals"])).toEqual({ goals: "héllo" });
  });
});
