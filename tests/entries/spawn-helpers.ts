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

/**
 * The path of a TypeScript entry point under src/. Node runs it directly by
 * stripping the types, which is how the plugin ships: nothing is built.
 */
export function scriptPath(relative: string): string {
  return join(ROOT, "src", relative);
}

/** Fails loudly (not with a cryptic spawn error) when the script is absent. */
export function requireScript(relative: string): void {
  if (!existsSync(scriptPath(relative))) {
    throw new Error(`src/${relative} is missing`);
  }
}

/**
 * Runs an entry point the way hooks/hooks.json does, with a controlled
 * environment. The flag matches hooks.json: Node 24.0 to 24.2 prints an
 * experimental-feature warning for type stripping, and later releases do not.
 */
export function runScript(
  relative: string,
  options: {
    readonly input?: string;
    readonly args?: readonly string[];
    readonly dataDir?: string | null;
    readonly env?: Readonly<Record<string, string>>;
  } = {},
): SpawnResult {
  requireScript(relative);
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
    [
      "--disable-warning=ExperimentalWarning",
      scriptPath(relative),
      ...(options.args ?? []),
    ],
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
