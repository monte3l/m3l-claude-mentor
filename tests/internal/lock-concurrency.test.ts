import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const FIXTURE = fileURLToPath(
  new URL("./fixtures/lock-increment.ts", import.meta.url),
);
const CHILDREN = 12;

interface ChildResult {
  readonly code: number | null;
  readonly stderr: string;
}

function runChild(dir: string, startAt: number): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        FIXTURE,
        dir,
        "15000",
        String(startAt),
      ],
      {
        env: { PATH: process.env["PATH"] ?? "" },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stderr });
    });
  });
}

describe("withStateLock across real processes", () => {
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "lock-conc-")));
    dir = join(root, "data");
    mkdirSync(dir);
    writeFileSync(join(dir, "goals.md"), "0");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("12 concurrent children lose no update and leave no lock file", async () => {
    // All children busy-wait until this instant so they contend together.
    const startAt = Date.now() + 800;
    const results = await Promise.all(
      Array.from({ length: CHILDREN }, () => runChild(dir, startAt)),
    );
    expect(results.map((r) => r.code)).toEqual(Array<number>(CHILDREN).fill(0));
    expect(results.map((r) => r.stderr)).toEqual(
      Array<string>(CHILDREN).fill(""),
    );
    expect(readFileSync(join(dir, "goals.md"), "utf8")).toBe(String(CHILDREN));
    expect(readdirSync(dir).filter((n) => n.startsWith(".state.lock"))).toEqual(
      [],
    );
  }, 120_000);
});
