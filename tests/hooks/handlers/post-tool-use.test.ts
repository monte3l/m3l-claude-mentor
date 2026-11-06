import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { postToolUseHandler } from "../../../src/hooks/handlers/post-tool-use.js";
import { parseCatalog } from "../../../src/internal/catalog.js";
import { parseEvidence } from "../../../src/internal/schema.js";
import { appendEvidence, readEvidence } from "../../../src/internal/store.js";
import {
  BAD_SESSIONS,
  CATALOG,
  NOW,
  SESSION,
  makeDeps,
  makeSandbox,
  payload,
  seedState,
  settingsWith,
  snapshot,
  topicId,
  withSession,
  type Sandbox,
} from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const SKILL = { tool_name: "Skill", tool_input: {} };
const AGENT = { tool_name: "Agent", tool_input: {} };

async function events(): Promise<
  readonly {
    topic: string;
    channel: string;
    session: string;
    result: string;
    at: number;
  }[]
> {
  return (await readEvidence(sb.dir, { maxEvents: 500 })).events;
}

function disable(...ids: string[]): typeof CATALOG {
  const p = parseCatalog(
    CATALOG.map((e) => (ids.includes(e.id) ? { ...e, enabled: false } : e)),
  );
  if (!p.ok) throw new Error("fixture");
  return p.value;
}

describe("postToolUseHandler recording", () => {
  test("appends one positive observed event and returns null", async () => {
    const out = await postToolUseHandler(payload(SKILL), makeDeps(sb.dir));
    expect(out).toBeNull();
    expect(await events()).toEqual([
      {
        channel: "observed",
        topic: "skills",
        result: "positive",
        at: NOW,
        session: SESSION,
      },
    ]);
  });

  test("appends every remaining signal of one event", async () => {
    const write = {
      tool_name: "Write",
      tool_input: {
        file_path: "/p/.claude/settings.json",
        content: '{"hooks": {}}',
      },
    };
    expect(
      await postToolUseHandler(payload(write), makeDeps(sb.dir)),
    ).toBeNull();
    const topics = (await events()).map((e) => e.topic).sort();
    expect(topics).toEqual(["hooks", "settings-scopes"]);
  });

  test("skips signals whose topic is disabled in the catalog", async () => {
    const write = {
      tool_name: "Write",
      tool_input: {
        file_path: "/p/.claude/settings.json",
        content: '{"hooks": {}}',
      },
    };
    const deps = makeDeps(sb.dir, { catalog: disable("hooks") });
    await postToolUseHandler(payload(write), deps);
    expect((await events()).map((e) => e.topic)).toEqual(["settings-scopes"]);
  });

  test("records nothing when the topic is absent from the catalog", async () => {
    const deps = makeDeps(sb.dir, {
      catalog: CATALOG.filter((e) => e.id !== "skills"),
    });
    expect(await postToolUseHandler(payload(SKILL), deps)).toBeNull();
    expect(existsSync(join(sb.dir, "evidence.jsonl"))).toBe(false);
  });

  test("does not touch profile or state", async () => {
    await postToolUseHandler(payload(SKILL), makeDeps(sb.dir));
    expect(existsSync(join(sb.dir, "profile.json"))).toBe(false);
    expect(existsSync(join(sb.dir, "state.json"))).toBe(false);
  });
});

describe("postToolUseHandler gating", () => {
  test("is a no-op when transcript analysis is off", async () => {
    const deps = makeDeps(sb.dir, {
      settings: settingsWith({ transcriptAnalysis: false }),
    });
    expect(await postToolUseHandler(payload(SKILL), deps)).toBeNull();
    expect(existsSync(sb.dir)).toBe(false);
  });

  test("does not touch the disk when there are no signals", async () => {
    const out = await postToolUseHandler(
      payload({ tool_name: "Read", tool_input: { file_path: "/x" } }),
      makeDeps(sb.dir),
    );
    expect(out).toBeNull();
    expect(existsSync(sb.dir)).toBe(false);
  });

  test.each([
    ["the same directory", "/a/b", "/a/b"],
    ["a nested directory", "/a/b", "/a/b/c"],
    ["a deep descendant of an ancestor", "/a", "/a/b/c/d"],
  ])(
    "records nothing inside an excluded project (%s)",
    async (_n, excluded, cwd) => {
      await seedState(sb.dir, { excludedProjects: [excluded] });
      expect(
        await postToolUseHandler(payload(SKILL), makeDeps(sb.dir, { cwd })),
      ).toBeNull();
      expect(existsSync(join(sb.dir, "evidence.jsonl"))).toBe(false);
    },
  );

  test("a sibling sharing a name prefix is not excluded", async () => {
    await seedState(sb.dir, { excludedProjects: ["/a/b"] });
    await postToolUseHandler(
      payload(SKILL),
      makeDeps(sb.dir, { cwd: "/a/bc" }),
    );
    expect(await events()).toHaveLength(1);
  });

  test("fails closed: a null cwd with excluded projects records nothing", async () => {
    await seedState(sb.dir, { excludedProjects: ["/a/b"] });
    const out = await postToolUseHandler(
      payload(SKILL),
      makeDeps(sb.dir, { cwd: null }),
    );
    expect(out).toBeNull();
    expect(existsSync(join(sb.dir, "evidence.jsonl"))).toBe(false);
  });

  test("a null cwd with no excluded projects still records", async () => {
    await seedState(sb.dir, { excludedProjects: [] });
    await postToolUseHandler(payload(SKILL), makeDeps(sb.dir, { cwd: null }));
    expect(await events()).toHaveLength(1);
  });

  test("excluded projects with no signals still touch no evidence", async () => {
    await seedState(sb.dir, { excludedProjects: ["/a/b"] });
    const before = snapshot(sb.dir);
    const out = await postToolUseHandler(
      payload({ tool_name: "Read", tool_input: { file_path: "/x" } }),
      makeDeps(sb.dir, { cwd: "/a/bc" }),
    );
    expect(out).toBeNull();
    expect(snapshot(sb.dir)).toEqual(before);
  });

  test.each(BAD_SESSIONS)(
    "returns null and writes nothing for a %s session id",
    async (_n, value) => {
      expect(
        await postToolUseHandler(withSession(value, SKILL), makeDeps(sb.dir)),
      ).toBeNull();
      expect(snapshot(sb.dir)).toBeNull();
    },
  );
});

describe("postToolUseHandler rate limit", () => {
  test("a repeat of the same topic in the same session is skipped", async () => {
    const deps = makeDeps(sb.dir);
    await postToolUseHandler(payload(SKILL), deps);
    const out = await postToolUseHandler(payload(SKILL), {
      ...deps,
      now: NOW + 5_000,
    });
    expect(out).toBeNull();
    expect(await events()).toHaveLength(1);
  });

  test("a different topic in the same session is still recorded", async () => {
    await postToolUseHandler(payload(SKILL), makeDeps(sb.dir));
    await postToolUseHandler(payload(AGENT), makeDeps(sb.dir));
    expect((await events()).map((e) => e.topic)).toEqual([
      "skills",
      "subagents",
    ]);
  });

  test("the same topic in another session is recorded", async () => {
    await postToolUseHandler(payload(SKILL), makeDeps(sb.dir));
    await postToolUseHandler(
      { session_id: "sess-2", ...SKILL },
      makeDeps(sb.dir),
    );
    expect((await events()).map((e) => e.session)).toEqual([SESSION, "sess-2"]);
  });

  test("an existing observed event for the session blocks a new one", async () => {
    const e = parseEvidence({
      channel: "observed",
      topic: "skills",
      result: "positive",
      at: 1,
      session: SESSION,
    });
    if (!e.ok) throw new Error("fixture");
    await appendEvidence(sb.dir, e.value);
    await postToolUseHandler(payload(SKILL), makeDeps(sb.dir));
    expect(await events()).toHaveLength(1);
  });

  test("evidence on another channel does not count toward the limit", async () => {
    const e = parseEvidence({
      channel: "quiz",
      topic: "skills",
      result: "positive",
      at: 1,
      session: SESSION,
    });
    if (!e.ok) throw new Error("fixture");
    await appendEvidence(sb.dir, e.value);
    await postToolUseHandler(payload(SKILL), makeDeps(sb.dir));
    expect((await events()).map((x) => x.channel)).toEqual([
      "quiz",
      "observed",
    ]);
    expect(topicId("skills")).toBe("skills");
  });
});
