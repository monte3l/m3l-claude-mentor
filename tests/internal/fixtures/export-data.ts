import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import {
  MentorStateError,
  type MentorErrorCode,
} from "../../../src/internal/errors.js";
import {
  defaultProfile,
  defaultState,
} from "../../../src/internal/state-schema.js";
import {
  appendEvidence,
  saveGoals,
  saveProfile,
  saveState,
} from "../../../src/internal/store.js";
import type { Evidence } from "../../../src/internal/schema.js";

/** Pinned clock for export tests. */
export const NOW = 1_700_000_000_000;

/** Asserts a promise rejects with a MentorStateError of `code`. */
export async function expectCode(
  promise: Promise<unknown>,
  code: MentorErrorCode,
): Promise<MentorStateError> {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(MentorStateError);
  expect((thrown as MentorStateError).code).toBe(code);
  return thrown as MentorStateError;
}

/** A valid evidence event. */
export const evidenceAt = (at: number, session = "sess-1"): Evidence =>
  ({
    channel: "quiz",
    topic: "plan-mode",
    result: "positive",
    at,
    session,
  }) as Evidence;

/** Fills `dir` with realistic data via the real savers. */
export async function seed(dir: string): Promise<void> {
  const state = {
    ...defaultState(NOW),
    muted: true,
    mutedTopics: ["hooks"],
    excludedProjects: ["/work/secret-project"],
    lastChangelogVersion: "2.1.0",
  } as unknown as ReturnType<typeof defaultState>;
  await saveState(dir, state);
  await saveProfile(dir, {
    ...defaultProfile(),
    topics: {
      "plan-mode": {
        introduced: true,
        level: "Recalled",
        lastPassAt: NOW - 1000,
        passes: 2,
      },
    },
    calibration: { confirmed: 3, refuted: 1 },
  });
  await saveGoals(dir, "Learn hooks\nand plan mode\n");
  await appendEvidence(dir, evidenceAt(NOW - 3000, "sess-1"));
  await appendEvidence(dir, evidenceAt(NOW - 2000, "sess-2"));
}

/** Snapshot of every entry in `dir` (name to bytes, or "<dir>"). */
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    out[entry.name] = entry.isDirectory()
      ? "<dir>"
      : readFileSync(join(dir, entry.name)).toString("base64");
  }
  return out;
}
