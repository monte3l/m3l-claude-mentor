import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  makeSandbox,
  read,
  run,
  runOk,
  seedEvidence,
  type Sandbox,
} from "./helpers.js";

let sb: Sandbox;
let other: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
  other = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
  other.cleanup();
});

async function populate(dir: string): Promise<void> {
  await runOk(dir, ["set-goals", "--text", "learn hooks"]);
  await runOk(dir, ["introduce", "--topic", "plan-mode"]);
  await runOk(dir, ["set-mute", "on"]);
  await seedEvidence(dir, "plan-mode", "quiz", "positive", 2);
}

describe("export", () => {
  test("writes a bundle file and reports evidenceSkipped", async () => {
    await populate(sb.dir);
    const to = join(sb.root, "bundle.json");
    expect(await runOk(sb.dir, ["export", "--to", to])).toEqual({
      exported: true,
      evidenceSkipped: 0,
    });
    expect(existsSync(to)).toBe(true);
  });
});

describe("import", () => {
  test("round-trips a bundle into another dir and returns the ImportSummary", async () => {
    await populate(sb.dir);
    const bundle = join(sb.root, "bundle.json");
    await runOk(sb.dir, ["export", "--to", bundle]);
    const out = await runOk(other.dir, [
      "import",
      "--from",
      bundle,
      "--replace",
    ]);
    expect(out).toMatchObject({
      state: true,
      profile: true,
      goals: true,
      evidenceEvents: 2,
    });
    expect(read(other.dir, "goals.md")).toBe("learn hooks");
    expect(
      ((await runOk(other.dir, ["get-profile"])) as { muted: boolean }).muted,
    ).toBe(true);
  });

  test("without --replace -> exit 1 CONFIRMATION_REQUIRED and data unchanged", async () => {
    await populate(sb.dir);
    const bundle = join(sb.root, "bundle.json");
    await runOk(sb.dir, ["export", "--to", bundle]);
    await runOk(other.dir, ["set-goals", "--text", "keep me"]);
    const result = await run(other.dir, ["import", "--from", bundle]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^CONFIRMATION_REQUIRED: [^\n]+\n$/);
    expect(read(other.dir, "goals.md")).toBe("keep me");
    expect(existsSync(join(other.dir, "profile.json"))).toBe(false);
  });

  test("a missing bundle file maps to a MentorStateError exit 1", async () => {
    const result = await run(sb.dir, [
      "import",
      "--from",
      join(sb.root, "nope.json"),
      "--replace",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^[A-Z_]+: [^\n]+\n$/);
  });
});

describe("purge", () => {
  test("--confirm deletes the data files and returns the PurgeResult", async () => {
    await populate(sb.dir);
    const out = (await runOk(sb.dir, ["purge", "--confirm"])) as {
      deleted: string[];
      alreadyMissing: string[];
    };
    expect(out.deleted).toEqual(
      expect.arrayContaining(["state", "profile", "goals", "evidence"]),
    );
    expect(existsSync(join(sb.dir, "goals.md"))).toBe(false);
    expect(existsSync(join(sb.dir, "evidence.jsonl"))).toBe(false);
  });

  test("without --confirm -> exit 1 CONFIRMATION_REQUIRED and nothing deleted", async () => {
    await populate(sb.dir);
    const result = await run(sb.dir, ["purge"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^CONFIRMATION_REQUIRED: /);
    expect(read(sb.dir, "goals.md")).toBe("learn hooks");
    expect(existsSync(join(sb.dir, "evidence.jsonl"))).toBe(true);
    expect(existsSync(join(sb.dir, "profile.json"))).toBe(true);
  });
});
