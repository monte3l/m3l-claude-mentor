import { existsSync, readFileSync } from "node:fs";
import type * as FsPromises0 from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MentorStateError } from "../../src/internal/errors.ts";
import type { ParsedArgs } from "../../src/cli/args.ts";
import { examAnswer } from "../../src/cli/exam-session-commands.ts";
import { parseSessionId } from "../../src/internal/schema.ts";
import { defaultProfile } from "../../src/internal/state-schema.ts";
import { saveProfile } from "../../src/internal/store.ts";
import { NOW, SESSION, makeSandbox, read, type Sandbox } from "./helpers.ts";
import { THREE_ITEMS, beginOk, realCtx } from "./exam-helpers.ts";

type Fs = typeof FsPromises0;

// Faults are injected at the fs seam: the pending file is read first (so it
// cannot be made undeletable beforehand) and profile.json is read before it
// is saved (so a directory there would fail earlier).
const fault = vi.hoisted(() => ({
  unlinkSuffix: "",
  renameSuffix: "",
  error: new Error("injected fs failure"),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<Fs>();
  return {
    ...real,
    unlink: (path: Parameters<Fs["unlink"]>[0]) =>
      fault.unlinkSuffix !== "" && String(path).endsWith(fault.unlinkSuffix)
        ? Promise.reject(fault.error)
        : real.unlink(path),
    rename: (
      from: Parameters<Fs["rename"]>[0],
      to: Parameters<Fs["rename"]>[1],
    ) =>
      fault.renameSuffix !== "" && String(to).endsWith(fault.renameSuffix)
        ? Promise.reject(fault.error)
        : real.rename(from, to),
  };
});

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  fault.unlinkSuffix = "";
  fault.renameSuffix = "";
  sb.cleanup();
});

const has = (name: string): boolean => existsSync(join(sb.dir, name));
const lineCount = (name: string): number =>
  read(sb.dir, name).trimEnd().split("\n").length;

async function answerError(): Promise<MentorStateError> {
  const args: ParsedArgs = {
    positional: undefined,
    values: new Map([["answers", "B;A,C;D"]]),
    booleans: new Set(),
  };
  const { bundled } = await realCtx();
  const session = parseSessionId(SESSION);
  if (!session.ok) throw new Error("session fixture is invalid");
  try {
    await examAnswer(args, {
      dir: sb.dir,
      now: NOW,
      session: session.value,
      bundled: bundled ?? [],
    });
  } catch (error) {
    expect(error).toBeInstanceOf(MentorStateError);
    return error as MentorStateError;
  }
  throw new Error("expected exam-answer to fail");
}

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current instanceof Error && chain.length < 10) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

describe("exam-answer partial failures after the data was recorded", () => {
  test("a pending file that cannot be deleted: WRITE_FAILED saying the exam WAS recorded and must not be answered again", async () => {
    await saveProfile(sb.dir, defaultProfile());
    await beginOk(sb.dir, THREE_ITEMS);
    fault.unlinkSuffix = "exam-pending.json";
    const error = await answerError();
    expect(error.code).toBe("WRITE_FAILED");
    expect(error.message).toContain("recorded");
    expect(error.message).toMatch(/not/);
    expect(error.message).toMatch(/again/);
    expect(causeChain(error)).toContain(fault.error);
    expect(lineCount("evidence.jsonl")).toBe(3);
    expect(lineCount("exam-items.jsonl")).toBe(3);
    const stored = JSON.parse(read(sb.dir, "profile.json")) as {
      topics: Record<string, unknown>;
    };
    expect(Object.keys(stored.topics).sort()).toEqual([
      "agent-sdk",
      "api-key-handling",
      "streaming-events",
    ]);
    expect(has("exam-pending.json")).toBe(true);
  });

  test("a profile that cannot be saved: events and items recorded, profile not saved, pending kept", async () => {
    await beginOk(sb.dir, THREE_ITEMS);
    fault.renameSuffix = "profile.json";
    const error = await answerError();
    expect(error.code).toBe("WRITE_FAILED");
    expect(error.message).toContain("recorded 3 events and 3 of 3 exam items");
    expect(error.message).toContain("profile was not saved");
    expect(causeChain(error)).toContain(fault.error);
    expect(lineCount("evidence.jsonl")).toBe(3);
    expect(lineCount("exam-items.jsonl")).toBe(3);
    expect(has("profile.json")).toBe(false);
    expect(readFileSync(join(sb.dir, "exam-pending.json"), "utf8")).toContain(
      "CCDV-F",
    );
  });
});
