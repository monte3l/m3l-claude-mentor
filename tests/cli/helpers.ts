import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogEntry, Evidence } from "../../src/internal/schema.js";
import { parseCatalog } from "../../src/internal/catalog.js";
import { parseEvidence } from "../../src/internal/schema.js";
import { appendEvidence } from "../../src/internal/store.js";
import type { CliContext, CliResult } from "../../src/cli/commands.js";
import { runCommand } from "../../src/cli/commands.js";

/** A fixed "now": day 100 in epoch milliseconds. */
export const NOW = 100 * 86_400_000;
export const DAY = 86_400_000;
export const SESSION = "sess-1";

const rawCatalog: unknown = [
  {
    id: "context-window",
    title: "The context window",
    type: "concept",
    dependencies: [],
    keywords: ["context"],
    targetLevel: "Understood",
    enabled: true,
  },
  {
    id: "plan-mode",
    title: "Plan mode",
    type: "feature",
    dependencies: [],
    keywords: ["plan"],
    targetLevel: "Applied",
    enabled: true,
  },
];

const parsedCatalog = parseCatalog(rawCatalog);
if (!parsedCatalog.ok) throw new Error("test catalog fixture is invalid");
export const BUNDLED: readonly CatalogEntry[] = parsedCatalog.value;

export interface Sandbox {
  readonly root: string;
  readonly dir: string;
  cleanup(): void;
}

export function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "cli-"));
  return {
    root,
    dir: join(root, "data"),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function ctxFor(
  dir: string,
  overrides: Partial<CliContext> = {},
): CliContext {
  return { dir, now: NOW, session: SESSION, bundled: BUNDLED, ...overrides };
}

export function run(
  dir: string,
  argv: readonly string[],
  overrides: Partial<CliContext> = {},
): Promise<CliResult> {
  return runCommand(argv, ctxFor(dir, overrides));
}

/** Runs a command that must succeed and returns its parsed JSON stdout. */
export async function runOk(
  dir: string,
  argv: readonly string[],
  overrides: Partial<CliContext> = {},
): Promise<unknown> {
  const result = await run(dir, argv, overrides);
  if (result.exitCode !== 0) {
    throw new Error(
      `expected exit 0, got ${String(result.exitCode)}: ${result.stderr}`,
    );
  }
  if (!result.stdout.endsWith("\n"))
    throw new Error("stdout must end with a newline");
  return JSON.parse(result.stdout) as unknown;
}

export function put(dir: string, name: string, text: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), text);
}

export function read(dir: string, name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

export function readJson(dir: string, name: string): unknown {
  return JSON.parse(read(dir, name)) as unknown;
}

export async function seedEvidence(
  dir: string,
  topic: string,
  channel: Evidence["channel"],
  result: Evidence["result"],
  count: number,
  at: number = NOW,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const parsed = parseEvidence({
      channel,
      topic,
      result,
      at,
      session: SESSION,
    });
    if (!parsed.ok) throw new Error("evidence fixture is invalid");
    await appendEvidence(dir, parsed.value);
  }
}
