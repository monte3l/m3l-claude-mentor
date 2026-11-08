import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCatalog } from "../../../src/internal/catalog.js";
import {
  parseTopicId,
  type CatalogEntry,
  type TopicId,
} from "../../../src/internal/schema.js";
import {
  defaultProfile,
  defaultState,
  type MentorState,
  type Profile,
  type TopicProfile,
} from "../../../src/internal/state-schema.js";
import {
  loadState,
  saveProfile,
  saveState,
} from "../../../src/internal/store.js";
import type { HookDeps } from "../../../src/hooks/runtime.js";
import type { HookSettings } from "../../../src/hooks/settings.js";

/** A fixed clock: day 100 in epoch milliseconds. */
export const NOW = 100 * 86_400_000;
export const DAY = 86_400_000;
export const SESSION = "sess-1";

const raw: unknown = JSON.parse(
  readFileSync(
    new URL("../../../data/topic-catalog.json", import.meta.url),
    "utf8",
  ),
);
const parsed = parseCatalog(raw);
if (!parsed.ok) throw new Error("bundled catalog fixture is invalid");
export const CATALOG: readonly CatalogEntry[] = parsed.value;

export function topicId(value: string): TopicId {
  const p = parseTopicId(value);
  if (!p.ok) throw new Error(`bad topic id ${value}`);
  return p.value;
}

export interface Sandbox {
  readonly root: string;
  readonly dir: string;
  cleanup(): void;
}

export function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "hook-"));
  return {
    root,
    dir: join(root, "data"),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function makeDeps(
  dir: string,
  overrides: Partial<HookDeps> = {},
): HookDeps {
  const settings: HookSettings = { dial: 2, transcriptAnalysis: true };
  return { dir, now: NOW, settings, catalog: CATALOG, cwd: null, ...overrides };
}

export function settingsWith(overrides: Partial<HookSettings>): HookSettings {
  return { dial: 2, transcriptAnalysis: true, ...overrides };
}

export async function seedState(
  dir: string,
  patch: Partial<MentorState> = {},
): Promise<MentorState> {
  const state: MentorState = { ...defaultState(NOW), ...patch };
  await saveState(dir, state);
  return state;
}

export async function seedProfile(
  dir: string,
  topics: Readonly<Record<string, Partial<TopicProfile>>>,
): Promise<void> {
  const full: Record<string, TopicProfile> = {};
  for (const [id, t] of Object.entries(topics)) {
    full[id] = {
      introduced: false,
      level: "Unseen",
      lastPassAt: null,
      passes: 0,
      ...t,
    };
  }
  const profile: Profile = { ...defaultProfile(), topics: full };
  await saveProfile(dir, profile);
}

export function loadStateAt(dir: string): Promise<MentorState> {
  return loadState(dir, NOW);
}

/** Every file in `dir` with its bytes, or null when `dir` is absent. */
export function snapshot(dir: string): Record<string, string> | null {
  if (!existsSync(dir)) return null;
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    out[name] = readFileSync(join(dir, name), "utf8");
  }
  return out;
}

/** Payload with a valid session id and a hook event name. */
export function payload(
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return { session_id: SESSION, ...extra };
}

export const BAD_SESSIONS: readonly (readonly [string, unknown])[] = [
  ["missing", undefined],
  ["empty", ""],
  ["with spaces", "a b"],
  ["too long", "a".repeat(129)],
  ["number", 42],
  ["null", null],
];

/** A payload object whose `session_id` is `value` (omitted for undefined). */
export function withSession(
  value: unknown,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return value === undefined ? { ...extra } : { session_id: value, ...extra };
}
