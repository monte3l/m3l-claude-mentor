import type * as FsPromises0 from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { makeSandbox, read, readJson, type Sandbox } from "./helpers.ts";
import { SPEC_API_KEY } from "./exam-helpers.ts";
import { submit, voidCmd } from "./exam-void-helpers.ts";

type Fs = typeof FsPromises0;

// Faults are injected at the fs seam, switched on only after seeding.
const fault = vi.hoisted(() => ({ renameSuffix: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<Fs>();
  return {
    ...real,
    rename: (
      from: Parameters<Fs["rename"]>[0],
      to: Parameters<Fs["rename"]>[1],
    ) =>
      fault.renameSuffix !== "" && String(to).endsWith(fault.renameSuffix)
        ? Promise.reject(new Error("injected fs failure"))
        : real.rename(from, to),
  };
});

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  fault.renameSuffix = "";
  sb.cleanup();
});

describe("exam-void partial failure", () => {
  test("profile save failing after the void list was saved: WRITE_FAILED telling the user to run recompute", async () => {
    await submit(sb.dir, "s-a", 1_000_000, SPEC_API_KEY, "B");
    fault.renameSuffix = "profile.json";
    const result = await voidCmd(sb.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^WRITE_FAILED: /);
    expect(result.stderr).toContain("recompute");
    expect(result.stderr).toContain("api-key-handling");
    expect(result.stderr).toMatch(/levels? (was|were) not updated/);
    expect(
      (readJson(sb.dir, "state.json") as { voidedExams?: unknown }).voidedExams,
    ).toEqual([{ session: "s-a", at: 1_000_000 }]);
    expect(read(sb.dir, "profile.json")).toContain("api-key-handling");
  });
});
