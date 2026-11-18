import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROOT, scriptPath } from "./spawn-helpers.ts";

const BARRIER = fileURLToPath(
  new URL("../cli/fixtures/start-barrier.ts", import.meta.url),
);

export interface AsyncResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMs: number;
}

/**
 * Spawns a hook entry like hooks/hooks.json does, asynchronously so many can
 * run at once. With `startAt` (epoch ms) every child busy-waits to that
 * instant before loading the hook, so they all contend together.
 */
export function runEntryAsync(
  relative: string,
  options: {
    readonly input: string;
    readonly dataDir: string;
    readonly startAt?: number;
    /** Kills a hung child after this many ms (default 20 000). */
    readonly killAfterMs?: number;
  },
): Promise<AsyncResult> {
  const begin = Date.now();
  return new Promise((resolve, reject) => {
    const barrier = options.startAt === undefined ? [] : ["--import", BARRIER];
    const child = spawn(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        ...barrier,
        scriptPath(relative),
      ],
      {
        env: {
          PATH: process.env["PATH"] ?? "",
          CLAUDE_PLUGIN_ROOT: ROOT,
          CLAUDE_PLUGIN_DATA: options.dataDir,
          ...(options.startAt === undefined
            ? {}
            : { M3L_START_AT: String(options.startAt) }),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      stdout += c;
    });
    child.stderr.on("data", (c: string) => {
      stderr += c;
    });
    const killer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `hook ${relative} hung past ${String(options.killAfterMs ?? 20_000)} ms; stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
        ),
      );
    }, options.killAfterMs ?? 20_000);
    child.on("error", (error) => {
      clearTimeout(killer);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(killer);
      resolve({ status, stdout, stderr, elapsedMs: Date.now() - begin });
    });
    child.stdin.end(options.input);
  });
}
