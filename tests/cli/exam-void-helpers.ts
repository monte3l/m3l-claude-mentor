import { LEVELS } from "../../src/internal/schema.ts";
import { run, runOk } from "./helpers.ts";
import { beginOk, realCtx } from "./exam-helpers.ts";

export const USAGE_VOID =
  "usage: mentor-state exam-void [--at <ms> --session <id>]\n";
export const USAGE_UNVOID =
  "usage: mentor-state exam-unvoid --at <ms> --session <id>\n";

/** Runs a full exam-begin + exam-answer pair as `session` at clock `at`. */
export async function submit(
  dir: string,
  session: string,
  at: number,
  spec: string,
  answers: string,
): Promise<unknown> {
  await beginOk(dir, spec, { now: at, session });
  return runOk(
    dir,
    ["exam-answer", "--answers", answers],
    await realCtx({ now: at, session }),
  );
}

export async function voidCmd(
  dir: string,
  args: readonly string[] = [],
): ReturnType<typeof run> {
  return run(dir, ["exam-void", ...args], await realCtx());
}

export async function unvoidCmd(
  dir: string,
  args: readonly string[],
): ReturnType<typeof run> {
  return run(dir, ["exam-unvoid", ...args], await realCtx());
}

export const rank = (level: string): number =>
  LEVELS.indexOf(level as (typeof LEVELS)[number]);
