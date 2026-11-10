import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { makeSandbox, put, read, run, type Sandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const argv = [
  "record-batch",
  "--topic",
  "context-window",
  "--events",
  "quiz:positive,quiz:positive",
] as const;
const PRIOR =
  '{"channel":"quiz","topic":"plan-mode","result":"positive","at":1,"session":"s"}\n';

// Every predictable read must happen before the first write, so a failing
// read leaves evidence.jsonl exactly as it was (a retry must not duplicate).
describe("record-batch reads before it writes", () => {
  const broken: readonly (readonly [string, string, () => void])[] = [
    [
      "profile.json is not JSON",
      "PARSE_FAILED",
      () => put(sb.dir, "profile.json", "{"),
    ],
    [
      "profile.json is valid JSON with invalid content",
      "VALIDATION_FAILED",
      () => put(sb.dir, "profile.json", '{"topics":"nope"}'),
    ],
    [
      "profile.json is a directory",
      "READ_FAILED",
      () => mkdirSync(join(sb.dir, "profile.json"), { recursive: true }),
    ],
  ];

  describe.each([
    ["no evidence file yet", null],
    ["an existing evidence file", PRIOR],
  ] as const)("with %s", (_label, prior) => {
    test.each(broken)(
      "%s -> exit 1 %s and evidence is untouched",
      async (_name, code, setup) => {
        setup();
        if (prior !== null) put(sb.dir, "evidence.jsonl", prior);
        const result = await run(sb.dir, argv);
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toMatch(new RegExp(`^${code}: `));
        if (prior === null) {
          expect(() => read(sb.dir, "evidence.jsonl")).toThrow();
        } else {
          expect(read(sb.dir, "evidence.jsonl")).toBe(prior);
        }
      },
    );
  });
});
