import { appendFileSync, existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sessionStartHandler } from "../../../src/hooks/handlers/session-start.js";
import { parseCatalog } from "../../../src/internal/catalog.js";
import { EMPTY_CATALOG_FILE } from "../../../src/internal/catalog-file.js";
import { DATA_FILES } from "../../../src/internal/paths.js";
import {
  parseEvidence,
  type Channel,
  type Level,
} from "../../../src/internal/schema.js";
import {
  appendEvidence,
  loadProfile,
  saveCatalogFile,
} from "../../../src/internal/store.js";
import {
  CATALOG,
  DAY,
  NOW,
  SESSION,
  makeDeps,
  makeSandbox,
  payload,
  seedProfile,
  seedState,
  settingsWith,
  type Sandbox,
} from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

async function add(
  topic: string,
  channel: Channel,
  count: number,
  at = NOW,
  result: "positive" | "negative" = "positive",
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const e = parseEvidence({ channel, topic, result, at, session: SESSION });
    if (!e.ok) throw new Error("fixture");
    await appendEvidence(sb.dir, e.value);
  }
}

async function levelOnDisk(id: string): Promise<Level | undefined> {
  const profile = await loadProfile(sb.dir, NOW);
  return Object.hasOwn(profile.topics, id)
    ? profile.topics[id]?.level
    : undefined;
}

function rows(text: string | undefined): string[] {
  return (text ?? "").split("\n");
}

const profilePath = (): string => join(sb.dir, DATA_FILES.profile);

describe("sessionStartHandler recompute", () => {
  test("persists the derived level and the summary reflects the update", async () => {
    await seedProfile(sb.dir, { "claude-md": { level: "Unseen" } });
    await add("claude-md", "observed", 2);
    await add("context-window", "quiz", 2);
    const out = await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(await levelOnDisk("claude-md")).toBe("Applied");
    expect(await levelOnDisk("context-window")).toBe("Recalled");
    const text = rows(out?.hookSpecificOutput?.additionalContext);
    expect(text.some((l) => l.startsWith("claude-md:"))).toBe(false);
    expect(text).toContain("context-window: Recalled (target Understood)");
  });

  test("creates profile.json when evidence exists and none was stored", async () => {
    await add("skills", "observed", 2);
    await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(existsSync(profilePath())).toBe(true);
    expect(await levelOnDisk("skills")).toBe("Applied");
  });

  test("a stored level above the evidence is kept (raise-only)", async () => {
    await seedProfile(sb.dir, {
      skills: { introduced: true, level: "Fluent" },
    });
    await add("skills", "observed", 1);
    const before = statSync(profilePath());
    const bytes = readFileSync(profilePath(), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(await levelOnDisk("skills")).toBe("Fluent");
    expect(readFileSync(profilePath(), "utf8")).toBe(bytes);
    expect(statSync(profilePath()).mtimeMs).toBe(before.mtimeMs);
  });

  test("a quiz-earned Understood survives a stray observed event", async () => {
    await seedProfile(sb.dir, {
      "context-window": { introduced: true, level: "Understood" },
    });
    await add("context-window", "observed", 1);
    const out = await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(await levelOnDisk("context-window")).toBe("Understood");
    expect(
      rows(out?.hookSpecificOutput?.additionalContext).some((l) =>
        l.startsWith("context-window:"),
      ),
    ).toBe(false);
  });

  test("a raise over the stored level still persists", async () => {
    await seedProfile(sb.dir, {
      "context-window": { introduced: true, level: "Introduced", passes: 3 },
    });
    await add("context-window", "quiz", 2);
    await sessionStartHandler(payload(), makeDeps(sb.dir));
    const profile = await loadProfile(sb.dir, NOW);
    expect(profile.topics["context-window"]).toMatchObject({
      level: "Recalled",
      introduced: true,
      passes: 3,
    });
  });

  test("nothing changed leaves profile.json byte, inode and mtime identical", async () => {
    await seedProfile(sb.dir, { "claude-md": { level: "Applied" } });
    await add("claude-md", "observed", 2);
    const before = statSync(profilePath());
    const bytes = readFileSync(profilePath(), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await sessionStartHandler(payload(), makeDeps(sb.dir));
    const after = statSync(profilePath());
    expect(readFileSync(profilePath(), "utf8")).toBe(bytes);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ino).toBe(before.ino);
  });

  test("no evidence file creates no profile.json", async () => {
    await seedState(sb.dir);
    await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(existsSync(profilePath())).toBe(false);
  });

  test("a globally muted state still recomputes but returns null", async () => {
    await seedState(sb.dir, { muted: true });
    await add("claude-md", "observed", 2);
    expect(await sessionStartHandler(payload(), makeDeps(sb.dir))).toBeNull();
    expect(await levelOnDisk("claude-md")).toBe("Applied");
  });

  test("dial 0 still recomputes but returns null", async () => {
    await add("claude-md", "observed", 2);
    const deps = makeDeps(sb.dir, { settings: settingsWith({ dial: 0 }) });
    expect(await sessionStartHandler(payload(), deps)).toBeNull();
    expect(await levelOnDisk("claude-md")).toBe("Applied");
  });

  test("an invalid session id neither recomputes nor writes", async () => {
    await add("claude-md", "observed", 2);
    expect(
      await sessionStartHandler({ session_id: "a b" }, makeDeps(sb.dir)),
    ).toBeNull();
    expect(existsSync(profilePath())).toBe(false);
  });

  test("source compact recomputes too", async () => {
    await add("claude-md", "observed", 2);
    const out = await sessionStartHandler(
      payload({ source: "compact" }),
      makeDeps(sb.dir),
    );
    expect(await levelOnDisk("claude-md")).toBe("Applied");
    expect(rows(out?.hookSpecificOutput?.additionalContext)[0]).toBe(
      "m3l-claude-mentor learner state (restored after compaction)",
    );
  });

  test("evidence for a disabled topic is ignored", async () => {
    const parsed = parseCatalog(
      CATALOG.map((e) => (e.id === "skills" ? { ...e, enabled: false } : e)),
    );
    if (!parsed.ok) throw new Error("fixture");
    await add("skills", "observed", 2);
    await sessionStartHandler(
      payload(),
      makeDeps(sb.dir, { catalog: parsed.value }),
    );
    expect(existsSync(profilePath())).toBe(false);
  });

  test("corrupt evidence lines are skipped, valid ones still count", async () => {
    await add("claude-md", "observed", 1);
    appendFileSync(join(sb.dir, DATA_FILES.evidence), "{not json\n\n[1,2]\n");
    await add("claude-md", "observed", 1);
    await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(await levelOnDisk("claude-md")).toBe("Applied");
  });

  test("catalog.json scoring.halfLifeDays is honoured", async () => {
    await add("claude-md", "observed", 3, NOW - 30 * DAY);
    await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(await levelOnDisk("claude-md")).toBe("Introduced");

    await saveCatalogFile(sb.dir, {
      ...EMPTY_CATALOG_FILE,
      scoring: { halfLifeDays: 3650 },
    });
    await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(await levelOnDisk("claude-md")).toBe("Applied");
  });

  test("catalog.json scoring.fluencySessions is honoured", async () => {
    for (const [i, session] of ["fa", "fb", "fc"].entries()) {
      for (const channel of ["quiz", "explain-back"] as const) {
        const e = parseEvidence({
          channel,
          topic: "context-window",
          result: "positive",
          at: NOW - (DAY * (2 - i)) / 2,
          session,
        });
        if (!e.ok) throw new Error("fixture");
        await appendEvidence(sb.dir, e.value);
      }
    }
    await saveCatalogFile(sb.dir, {
      ...EMPTY_CATALOG_FILE,
      scoring: { fluencySessions: 4 },
    });
    await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(await levelOnDisk("context-window")).toBe("Understood");

    await saveCatalogFile(sb.dir, EMPTY_CATALOG_FILE);
    await sessionStartHandler(payload(), makeDeps(sb.dir));
    expect(await levelOnDisk("context-window")).toBe("Fluent");
  });
});
