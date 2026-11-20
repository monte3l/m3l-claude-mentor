import { loadBundledCatalog } from "../../src/internal/bundled-catalog.ts";
import type { CliContext } from "../../src/cli/commands.ts";
import { run, runOk } from "./helpers.ts";

/** Context overrides carrying the REAL bundled catalog (the exam topics). */
export async function realCtx(
  overrides: Partial<CliContext> = {},
): Promise<Partial<CliContext>> {
  return { bundled: await loadBundledCatalog(), ...overrides };
}

export const SPEC_API_KEY = "D7.3|api-key-handling|single|B";
export const SPEC_AGENT_SDK = "D1.2|agent-sdk|multiple|A,C";
export const SPEC_STREAMING = "D2.4|streaming-events|single|D";
/** Three CCDV-F items; keys B / A,C / D. */
export const THREE_ITEMS = [SPEC_API_KEY, SPEC_AGENT_SDK, SPEC_STREAMING].join(
  ";",
);

export const USAGE_BEGIN =
  "usage: mentor-state exam-begin --track <code> --mode <drill|mock> --items <spec;spec...>\n";
export const USAGE_ANSWER =
  "usage: mentor-state exam-answer --answers <letters;letters...>\n";

export function begin(
  dir: string,
  items: string,
  overrides: Partial<CliContext> = {},
  track = "CCDV-F",
  mode = "drill",
): ReturnType<typeof run> {
  return realCtx(overrides).then((o) =>
    run(
      dir,
      ["exam-begin", "--track", track, "--mode", mode, "--items", items],
      o,
    ),
  );
}

export async function beginOk(
  dir: string,
  items: string,
  overrides: Partial<CliContext> = {},
): Promise<unknown> {
  return runOk(
    dir,
    ["exam-begin", "--track", "CCDV-F", "--mode", "drill", "--items", items],
    await realCtx(overrides),
  );
}
