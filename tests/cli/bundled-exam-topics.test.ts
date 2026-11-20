import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadBundledCatalog } from "../../src/internal/bundled-catalog.ts";
import { runOk, makeSandbox, type Sandbox } from "./helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

interface Row {
  id: string;
  ambient: boolean;
}

describe("topics CLI over the real bundled catalog", () => {
  test("the 49 exam topics report ambient:false and the original 25 report true", async () => {
    const { topics } = (await runOk(sb.dir, ["topics"], {
      bundled: await loadBundledCatalog(),
    })) as { topics: Row[] };
    expect(topics).toHaveLength(74);
    expect(topics.slice(0, 25).every((r) => r.ambient)).toBe(true);
    const exam = topics.slice(25);
    expect(exam).toHaveLength(49);
    for (const row of exam) expect(row.ambient, row.id).toBe(false);
  });
});
