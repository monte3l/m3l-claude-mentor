import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sessionStartHandler } from "../../../src/hooks/handlers/session-start.ts";
import { parseCatalog } from "../../../src/internal/catalog.ts";
import type { CatalogEntry } from "../../../src/internal/schema.ts";
import {
  makeDeps,
  makeSandbox,
  payload,
  seedProfile,
  type Sandbox,
} from "./helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const DUE = { introduced: true, lastPassAt: 0, passes: 1 } as const;
const AMBIENT_IDS = ["alpha", "beta", "gamma", "delta", "eps", "zeta"].flatMap(
  (id) => [`${id}-one`, `${id}-two`],
);

function entry(id: string, extra: Record<string, unknown> = {}): unknown {
  return {
    id,
    title: id,
    type: "concept",
    dependencies: [],
    keywords: [id],
    targetLevel: "Recalled",
    enabled: true,
    ...extra,
  };
}

/** `exam-topic` first in catalog order, then twelve ordinary topics. */
function catalogWith(examExtra: Record<string, unknown>): CatalogEntry[] {
  const parsed = parseCatalog([
    entry("exam-topic", examExtra),
    ...AMBIENT_IDS.map((id) => entry(id)),
  ]);
  if (!parsed.ok) throw new Error("fixture invalid");
  return [...parsed.value];
}

async function rowsFor(
  catalog: CatalogEntry[],
  profileTopics: Parameters<typeof seedProfile>[1],
): Promise<string[]> {
  await seedProfile(sb.dir, profileTopics);
  const out = await sessionStartHandler(
    payload(),
    makeDeps(sb.dir, { catalog }),
  );
  return (out?.hookSpecificOutput?.additionalContext ?? "").split("\n");
}

function allAtTarget(): Parameters<typeof seedProfile>[1] {
  return Object.fromEntries(
    AMBIENT_IDS.map((id) => [
      id,
      { introduced: true, level: "Recalled" as const },
    ]),
  );
}

describe("SessionStart honours ambient: false in below-target lines", () => {
  test("an Unseen ambient:false topic is omitted and the block is absent when every ambient topic is at target", async () => {
    const rows = await rowsFor(catalogWith({ ambient: false }), allAtTarget());
    expect(rows).not.toContain("topics below target:");
    expect(rows.some((l) => l.includes("exam-topic"))).toBe(false);
  });

  test("control: the same topic without ambient is listed", async () => {
    const rows = await rowsFor(catalogWith({}), allAtTarget());
    expect(rows).toContain("topics below target:");
    expect(rows).toContain("exam-topic: Unseen (target Recalled)");
  });

  test("control: ambient:true is listed", async () => {
    const rows = await rowsFor(catalogWith({ ambient: true }), allAtTarget());
    expect(rows).toContain("exam-topic: Unseen (target Recalled)");
  });

  test("a touched, below-target ambient:false topic is still omitted", async () => {
    const rows = await rowsFor(catalogWith({ ambient: false }), {
      ...allAtTarget(),
      "exam-topic": { introduced: true, level: "Introduced" },
    });
    expect(rows.some((l) => l.includes("exam-topic"))).toBe(false);
    expect(rows).not.toContain("topics below target:");
  });

  test("the 8-line cap and order are computed over the remaining entries", async () => {
    const rows = await rowsFor(catalogWith({ ambient: false }), {});
    const at = rows.indexOf("topics below target:");
    expect(at).toBeGreaterThanOrEqual(0);
    const listed = rows.slice(at + 1).filter((l) => l.includes("(target "));
    expect(listed).toEqual(
      AMBIENT_IDS.slice(0, 8).map((id) => `${id}: Unseen (target Recalled)`),
    );
  });

  test("control: without ambient:false the first-in-catalog topic takes a slot", async () => {
    const rows = await rowsFor(catalogWith({}), {});
    const at = rows.indexOf("topics below target:");
    expect(rows[at + 1]).toBe("exam-topic: Unseen (target Recalled)");
    expect(rows.filter((l) => l.includes("(target "))).toHaveLength(8);
  });
});

describe("SessionStart honours ambient: false in review-due lines", () => {
  test("an ambient:false topic with a due review is excluded; a due ambient topic is listed", async () => {
    const rows = await rowsFor(catalogWith({ ambient: false }), {
      ...allAtTarget(),
      "exam-topic": { ...DUE, level: "Recalled" },
      "alpha-one": { ...DUE, level: "Recalled" },
    });
    expect(rows).toContain("review due: alpha-one");
    expect(rows).not.toContain("review due: exam-topic");
  });

  test("control: without ambient:false the due topic is listed", async () => {
    const rows = await rowsFor(catalogWith({}), {
      ...allAtTarget(),
      "exam-topic": { ...DUE, level: "Recalled" },
    });
    expect(rows).toContain("review due: exam-topic");
  });

  test("the 5-line review cap is computed over the remaining entries", async () => {
    const due = Object.fromEntries(
      ["exam-topic", ...AMBIENT_IDS.slice(0, 6)].map((id) => [
        id,
        { ...DUE, level: "Recalled" as const },
      ]),
    );
    const rows = await rowsFor(catalogWith({ ambient: false }), due);
    expect(rows.filter((l) => l.startsWith("review due: "))).toEqual(
      AMBIENT_IDS.slice(0, 5).map((id) => `review due: ${id}`),
    );
  });
});
