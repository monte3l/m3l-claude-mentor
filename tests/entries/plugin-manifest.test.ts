import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ROOT } from "./spawn-helpers.js";

interface Manifest {
  name?: string;
  version?: string;
  options?: unknown;
  userConfig?: Record<string, Record<string, unknown>>;
}

const raw = readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8");
const manifest = JSON.parse(raw) as Manifest;

describe(".claude-plugin/plugin.json", () => {
  test("keeps its name and version", () => {
    expect(manifest.name).toBe("m3l-claude-mentor");
    expect(manifest.version).toBe("0.1.0");
  });

  test("declares the dial option", () => {
    expect(manifest.userConfig?.["dial"]).toMatchObject({
      type: "number",
      min: 0,
      max: 5,
      default: 2,
    });
    const dial = manifest.userConfig?.["dial"];
    expect(String(dial?.["title"]).length).toBeGreaterThan(0);
    expect(String(dial?.["description"]).length).toBeGreaterThan(0);
  });

  test("declares the transcriptAnalysis option", () => {
    const option = manifest.userConfig?.["transcriptAnalysis"];
    expect(option).toMatchObject({ type: "boolean", default: true });
    expect(String(option?.["title"]).length).toBeGreaterThan(0);
    expect(String(option?.["description"]).length).toBeGreaterThan(0);
  });

  test("has no `options` field (it needs Claude Code 2.1.271+)", () => {
    expect(manifest.options).toBeUndefined();
    expect(raw).not.toMatch(/"options"\s*:/u);
  });
});
