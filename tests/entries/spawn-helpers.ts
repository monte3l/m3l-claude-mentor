import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root (the plugin root). */
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface SpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Sandbox {
  readonly root: string;
  readonly dir: string;
  cleanup(): void;
}

export function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "entry-"));
  return {
    root,
    dir: join(root, "data"),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The compiled path of a script; `pnpm build` must have run first. */
export function distPath(relative: string): string {
  return join(ROOT, "dist", relative);
}

/** Fails loudly (not with a cryptic spawn error) when the build is absent. */
export function requireBuilt(relative: string): void {
  if (!existsSync(distPath(relative))) {
    throw new Error(
      `dist/${relative} is missing: run \`pnpm build\` before these tests`,
    );
  }
}

/** Runs a compiled script with a controlled environment. */
export function runDist(
  relative: string,
  options: {
    readonly input?: string;
    readonly args?: readonly string[];
    readonly dataDir?: string | null;
    readonly env?: Readonly<Record<string, string>>;
  } = {},
): SpawnResult {
  requireBuilt(relative);
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    CLAUDE_PLUGIN_ROOT: ROOT,
    ...options.env,
  };
  if (options.dataDir !== null && options.dataDir !== undefined) {
    env["CLAUDE_PLUGIN_DATA"] = options.dataDir;
  }
  const result = spawnSync(
    process.execPath,
    [distPath(relative), ...(options.args ?? [])],
    {
      input: options.input ?? "",
      env,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Asserts stdout is empty or exactly one JSON document; returns it. */
export function parseSingleJson(stdout: string): unknown {
  if (stdout === "") return undefined;
  return JSON.parse(stdout) as unknown;
}
