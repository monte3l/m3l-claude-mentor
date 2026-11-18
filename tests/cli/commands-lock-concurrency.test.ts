import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI = join(ROOT, "src", "cli", "mentor-state.ts");
const BARRIER = fileURLToPath(
  new URL("./fixtures/start-barrier.ts", import.meta.url),
);
const CHILDREN = 10;

function runCli(
  dir: string,
  startAt: number,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        "--import",
        BARRIER,
        CLI,
        "--data-dir",
        dir,
        "record-pass",
        "--topic",
        "plan-mode",
        "--result",
        "pass",
      ],
      {
        env: {
          PATH: process.env["PATH"] ?? "",
          CLAUDE_PLUGIN_ROOT: ROOT,
          M3L_START_AT: String(startAt),
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c: string) => {
      stderr += c;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stderr });
    });
  });
}

describe("CLI writers across real processes", () => {
  let root: string;
  let dir: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "cli-conc-")));
    dir = join(root, "data");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("10 concurrent record-pass runs all land and leave no lock file", async () => {
    const startAt = Date.now() + 1500;
    const results = await Promise.all(
      Array.from({ length: CHILDREN }, () => runCli(dir, startAt)),
    );
    expect(results.map((r) => r.stderr)).toEqual(
      Array<string>(CHILDREN).fill(""),
    );
    expect(results.map((r) => r.code)).toEqual(Array<number>(CHILDREN).fill(0));
    const profile = JSON.parse(
      readFileSync(join(dir, "profile.json"), "utf8"),
    ) as { topics: Record<string, { passes: number }> };
    expect(profile.topics["plan-mode"]?.passes).toBe(CHILDREN);
    expect(readdirSync(dir).filter((n) => n.startsWith(".state.lock"))).toEqual(
      [],
    );
  }, 120_000);
});
