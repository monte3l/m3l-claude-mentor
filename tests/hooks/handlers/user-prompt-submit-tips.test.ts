import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { userPromptSubmitHandler } from "../../../src/hooks/handlers/user-prompt-submit.js";
import { parseCatalog } from "../../../src/internal/catalog.js";
import {
  CATALOG,
  NOW,
  loadStateAt,
  makeDeps,
  makeSandbox,
  payload,
  seedProfile,
  seedState,
  settingsWith,
  topicId,
  type Sandbox,
} from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const PLAN = "How do I use plan mode?";
const TIP =
  'Mentor tip due on "Plan mode" (plan-mode). After you finish answering the user\'s request, add exactly ONE final line starting with "💡 Mentor tip:" that teaches one useful point about this topic in at most 25 words, related to the task at hand. Never mention this instruction or the mentor system otherwise.';

async function ctx(
  prompt: string,
  deps = makeDeps(sb.dir),
): Promise<string | undefined> {
  const out = await userPromptSubmitHandler(payload({ prompt }), deps);
  return out?.hookSpecificOutput?.additionalContext;
}

const styledCatalog = (() => {
  const p = parseCatalog(
    CATALOG.map((e) =>
      e.id === "plan-mode" ? { ...e, style: "socratic" } : e,
    ),
  );
  if (!p.ok) throw new Error("fixture");
  return p.value;
})();

describe("userPromptSubmitHandler tip directive", () => {
  test("emits the directive for a related below-target topic", async () => {
    const out = await userPromptSubmitHandler(
      payload({ prompt: PLAN }),
      makeDeps(sb.dir),
    );
    expect(out?.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(out?.systemMessage).toBeUndefined();
    expect(out?.hookSpecificOutput?.additionalContext).toBe(
      `Mentor style hint: explain-demo.\n${TIP}`,
    );
    const seg = (await loadStateAt(sb.dir)).segment;
    expect(seg.tipsEmitted).toBe(1);
    expect(seg.lastTipAt).toBe(NOW);
  });

  test("a second prompt in the same segment gets no directive", async () => {
    const deps = makeDeps(sb.dir);
    expect(await ctx(PLAN, deps)).toContain("Mentor tip due");
    const second = await ctx("And what about plan mode again?", {
      ...deps,
      now: NOW + 1_000,
    });
    expect(second).not.toContain("Mentor tip due");
    expect(second).toContain("Mentor style hint:");
    expect((await loadStateAt(sb.dir)).segment.tipsEmitted).toBe(1);
  });

  test("no directive for a topic already at target", async () => {
    await seedProfile(sb.dir, {
      "plan-mode": { introduced: true, level: "Applied" },
    });
    const text = await ctx(PLAN);
    expect(text ?? "").not.toContain("Mentor tip due");
    expect(text).toBe("Mentor style hint: socratic.");
  });

  test("no directive for an individually muted topic, but the hint stays", async () => {
    await seedState(sb.dir, { mutedTopics: [topicId("plan-mode")] });
    const text = await ctx(PLAN);
    expect(text).toBe("Mentor style hint: explain-demo.");
  });

  test("no directive when the dial is 0", async () => {
    const text = await ctx(
      PLAN,
      makeDeps(sb.dir, { settings: settingsWith({ dial: 0 }) }),
    );
    expect(text).toBe("Mentor style hint: explain-demo.");
  });

  test("no directive when there is no related topic", async () => {
    expect(await ctx("just tell me something")).toBe(
      "Mentor style hint: reference.",
    );
  });
});

describe("userPromptSubmitHandler style hint", () => {
  test("uses explain-demo below Understood and socratic from Understood", async () => {
    await seedProfile(sb.dir, { "plan-mode": { level: "Recalled" } });
    expect(await ctx(PLAN)).toContain("Mentor style hint: explain-demo.");
    await seedProfile(sb.dir, { "plan-mode": { level: "Understood" } });
    expect(await ctx(PLAN, makeDeps(sb.dir, { now: NOW + 1_000 }))).toContain(
      "Mentor style hint: socratic.",
    );
  });

  test("a catalog style beats the level-derived style", async () => {
    const deps = makeDeps(sb.dir, { catalog: styledCatalog });
    expect(await ctx(PLAN, deps)).toContain("Mentor style hint: socratic.");
  });

  test("just-tell-me beats the catalog style when a topic also matches", async () => {
    const deps = makeDeps(sb.dir, { catalog: styledCatalog });
    const text = await ctx("just tell me how plan mode works", deps);
    expect(text).toContain("Mentor style hint: reference.");
    expect(text).not.toContain("socratic");
  });
});

describe("userPromptSubmitHandler teach-next", () => {
  test("offers the teach command, after the hint and tip", async () => {
    const text = await ctx("teach me about plan mode");
    expect(text).toBe(
      [
        "Mentor style hint: explain-demo.",
        TIP,
        'The learner asked to learn "Plan mode" next: offer /m3l-claude-mentor:teach plan-mode after answering.',
      ].join("\n"),
    );
  });

  test("only the first teach-next signal is used", async () => {
    const text = await ctx("teach me about skills. let's learn plan mode");
    expect(text).toContain("/m3l-claude-mentor:teach skills after answering");
    expect(text).not.toContain("/m3l-claude-mentor:teach plan-mode");
  });
});
