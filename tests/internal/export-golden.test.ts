import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  BUNDLE_FORMAT,
  LEGACY_BUNDLE_FORMAT,
  exportBundle,
  importBundleFromFile,
  parseBundle,
  serializeBundle,
  type Bundle,
} from "../../src/internal/export.ts";
import { NOW } from "./fixtures/export-data.ts";
// NOW matches the fixture exportedAt only by coincidence; exportBundle is
// handed it as the clock, and the compared sections do not include exportedAt.

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "bundle-v1.json",
);

function loadFixture(): Bundle {
  const parsed = parseBundle(JSON.parse(readFileSync(FIXTURE, "utf8")));
  if (!parsed.ok) throw new Error(`fixture rejected: ${parsed.reason}`);
  return parsed.value;
}

// Written by hand from bundle-v1.json, deliberately not derived from it.
const EXPECTED = {
  format: "m3l-mentor-export",
  version: 1,
  exportedAt: 1_700_000_000_000,
  state: {
    schemaVersion: 1,
    muted: false,
    mutedTopics: ["hooks"],
    excludedProjects: ["/work/secret-project"],
    lastChangelogVersion: "2.1.0",
    segment: {
      segmentId: 4,
      startedAt: 1_699_990_000_000,
      lastActivityAt: 1_699_999_000_000,
      tipsEmitted: 1,
      lastTipAt: 1_699_995_000_000,
      lastTopic: "plan-mode",
    },
  },
  profile: {
    schemaVersion: 1,
    topics: {
      "plan-mode": {
        introduced: true,
        level: "Recalled",
        lastPassAt: 1_699_999_500_000,
        passes: 2,
      },
      hooks: {
        introduced: true,
        level: "Introduced",
        lastPassAt: null,
        passes: 0,
      },
    },
    calibration: { confirmed: 3, refuted: 1 },
  },
  catalog: {
    user: {
      overrides: { "plan-mode": { targetLevel: "Fluent" } },
      custom: [
        {
          id: "team-conventions",
          title: "Team conventions",
          type: "concept",
          dependencies: [],
          keywords: ["conventions", "team"],
          targetLevel: "Understood",
          enabled: true,
        },
      ],
    },
    scoring: { halfLifeDays: 45, fluencySessions: 4 },
  },
  goals: "Learn hooks\nand plan mode\n",
  evidence: [
    {
      channel: "quiz",
      topic: "plan-mode",
      result: "negative",
      at: 1_699_990_000_000,
      session: "sess-1",
    },
    {
      channel: "observed",
      topic: "plan-mode",
      result: "positive",
      at: 1_699_995_000_000,
      session: "sess-2",
    },
    {
      channel: "explain-back",
      topic: "hooks",
      result: "positive",
      at: 1_699_999_000_000,
      session: "sess-2",
    },
  ],
};

let sandbox = "";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "export-golden-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("golden v1 export bundle", () => {
  test("parseBundle accepts the committed v1 fixture as this exact bundle", () => {
    expect(loadFixture()).toEqual(EXPECTED);
  });

  test("imports through the real path and exports the same sections", async () => {
    const dir = join(sandbox, "data");
    const summary = await importBundleFromFile(dir, FIXTURE, { replace: true });
    expect(summary.evidenceEvents).toBe(3);

    const original = loadFixture();
    const { bundle, evidenceSkipped } = await exportBundle(dir, NOW);
    expect(evidenceSkipped).toBe(0);
    expect(bundle.state).toEqual(original.state);
    expect(bundle.profile).toEqual(original.profile);
    expect(bundle.catalog).toEqual(original.catalog);
    expect(bundle.goals).toBe(original.goals);
    expect(bundle.evidence).toEqual(original.evidence);
  });

  test("serializeBundle writes the frozen layout", () => {
    expect(JSON.parse(serializeBundle(loadFixture()))).toEqual(
      JSON.parse(readFileSync(FIXTURE, "utf8")),
    );
  });

  test("serializeBundle(parseBundle(fixture)) re-parses to an equal bundle", () => {
    const original = loadFixture();
    const reparsed = parseBundle(JSON.parse(serializeBundle(original)));
    expect(reparsed).toEqual({ ok: true, value: original });
  });
});

// An export written while the plugin was still called m3l-claude-mentor (up to
// 1.2.0) carries the old format tag. It must keep importing, byte for byte the
// same learner data, and the plugin must never write that tag again.
describe("export bundle of the former plugin name", () => {
  const LEGACY_FIXTURE = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "bundle-v1-legacy-format.json",
  );

  test("the legacy fixture differs from the golden one only in its format tag", () => {
    const legacy = JSON.parse(readFileSync(LEGACY_FIXTURE, "utf8")) as Record<
      string,
      unknown
    >;
    const current = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<
      string,
      unknown
    >;
    expect(legacy["format"]).toBe(LEGACY_BUNDLE_FORMAT);
    expect({ ...legacy, format: current["format"] }).toEqual(current);
  });

  test("parseBundle accepts it and returns the current format tag", () => {
    const parsed = parseBundle(
      JSON.parse(readFileSync(LEGACY_FIXTURE, "utf8")),
    );
    expect(parsed).toEqual({ ok: true, value: EXPECTED });
    if (parsed.ok) expect(parsed.value.format).toBe(BUNDLE_FORMAT);
  });

  test("serializeBundle never writes the old tag", () => {
    const parsed = parseBundle(
      JSON.parse(readFileSync(LEGACY_FIXTURE, "utf8")),
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(serializeBundle(parsed.value)).not.toContain(LEGACY_BUNDLE_FORMAT);
  });

  test("imports through the real path and exports the current format", async () => {
    const dir = join(sandbox, "data");
    const summary = await importBundleFromFile(dir, LEGACY_FIXTURE, {
      replace: true,
    });
    expect(summary.evidenceEvents).toBe(3);
    const { bundle } = await exportBundle(dir, NOW);
    expect(bundle.format).toBe(BUNDLE_FORMAT);
    expect(bundle.goals).toBe(EXPECTED.goals);
  });

  test("any other format tag is still rejected, naming the current one", () => {
    const record = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<
      string,
      unknown
    >;
    for (const format of [
      "m3l-other-export",
      "m3l-claude-mentor-exports",
      "",
    ]) {
      const parsed = parseBundle({ ...record, format });
      expect(parsed).toEqual({
        ok: false,
        reason: `bundle format must be ${BUNDLE_FORMAT}`,
      });
    }
  });
});
