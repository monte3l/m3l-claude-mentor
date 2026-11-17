import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  ROOT,
  distPath,
  makeSandbox,
  runDist,
  requireBuilt,
  type Sandbox,
} from "./spawn-helpers.js";

const START = "hooks/entry-session-start.js";
const PROMPT = "hooks/entry-user-prompt-submit.js";
const STOP = "hooks/entry-stop.js";
const POST = "hooks/entry-post-tool-use.js";
const POST_COMPACT = "hooks/entry-post-compact.js";

let sb: Sandbox;
beforeAll(() => {
  for (const f of [START, PROMPT, STOP]) requireBuilt(f);
});
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

interface Exit {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawns an entry and destroys the parent's read end of the chosen stream
 * before the child is given any input, so its write hits a closed pipe.
 */
function runWithClosedPipe(
  script: string,
  closed: "stdout" | "stderr",
  input: string,
  dataDir: string,
): Promise<Exit> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: {
        PATH: process.env["PATH"] ?? "",
        CLAUDE_PLUGIN_ROOT: ROOT,
        CLAUDE_PLUGIN_DATA: dataDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const other = closed === "stdout" ? child.stderr : child.stdout;
    other.setEncoding("utf8");
    other.on("data", (d: string) => {
      if (closed === "stdout") stderr += d;
      else stdout += d;
    });
    child[closed].destroy();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("hook did not exit"));
    }, 20_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

describe("a closed output pipe never crashes a hook", () => {
  test("control: with nothing closed, SessionStart writes non-empty stdout", () => {
    const r = runDist(START, {
      input: JSON.stringify({
        session_id: "s1",
        hook_event_name: "SessionStart",
        source: "startup",
      }),
      dataDir: sb.dir,
    });
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(0);
  });

  test("control: with stderr open, UserPromptSubmit on bad JSON writes a stderr note", () => {
    const r = runDist(PROMPT, { input: "{nope", dataDir: sb.dir });
    expect(r.status).toBe(0);
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  test("stdout closed early: exit 0 and no stack trace", async () => {
    const r = await runWithClosedPipe(
      distPath(START),
      "stdout",
      JSON.stringify({
        session_id: "s1",
        hook_event_name: "SessionStart",
        source: "startup",
      }),
      sb.dir,
    );
    expect(r.code).toBe(0);
    expect(r.stderr).not.toMatch(/EPIPE|\n\s+at |node:internal/);
  });

  test("stderr closed early: exit 0 and no stack trace", async () => {
    // Invalid JSON makes the hook write a note to stderr.
    const r = await runWithClosedPipe(
      distPath(PROMPT),
      "stderr",
      "{nope",
      sb.dir,
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("hook entries have no static plugin imports", () => {
  const entries = readdirSync(join(ROOT, "src", "hooks")).filter((f) =>
    /^entry-.*\.ts$/.test(f),
  );

  test("there are entry sources to check", () => {
    expect(entries.length).toBeGreaterThanOrEqual(5);
  });

  test.each(entries)("%s has no static relative import", (file) => {
    const text = readFileSync(join(ROOT, "src", "hooks", file), "utf8");
    expect(text).not.toMatch(/^\s*import\b[^(]*?from\s*["']\.\//m);
    expect(text).not.toMatch(/^\s*import\s*["']\.\//m);
    expect(text).toMatch(/import\(/);
  });
});

describe("a broken install still exits 0", () => {
  let copy = "";
  beforeEach(() => {
    copy = mkdtempSync(join(tmpdir(), "broken-install-"));
    cpSync(join(ROOT, "dist"), join(copy, "dist"), { recursive: true });
    cpSync(join(ROOT, "package.json"), join(copy, "package.json"));
    cpSync(join(ROOT, "data"), join(copy, "data"), { recursive: true });
    symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"));
  });
  afterEach(() => {
    rmSync(copy, { recursive: true, force: true });
  });

  const run = (relative: string, input: string) =>
    spawnSync(process.execPath, [join(copy, "dist", relative)], {
      input,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        PATH: process.env["PATH"] ?? "",
        CLAUDE_PLUGIN_ROOT: copy,
        CLAUDE_PLUGIN_DATA: sb.dir,
      },
    });

  const ENTRIES = [
    [
      "SessionStart",
      START,
      "hooks/handlers/session-start.js",
      { session_id: "s1", hook_event_name: "SessionStart", source: "startup" },
    ],
    [
      "UserPromptSubmit",
      PROMPT,
      "hooks/handlers/user-prompt-submit.js",
      { session_id: "s1", prompt: "hello there" },
    ],
    [
      "PostToolUse",
      POST,
      "hooks/handlers/post-tool-use.js",
      {
        session_id: "s1",
        tool_name: "Write",
        tool_input: { file_path: "/proj/a.txt", content: "x" },
      },
    ],
    ["Stop", STOP, "hooks/handlers/stop.js", { session_id: "s1" }],
    [
      "PostCompact",
      POST_COMPACT,
      "hooks/handlers/post-compact.js",
      { session_id: "s1", cwd: "/proj" },
    ],
  ] as const;

  const noStack = /\n\s+at |node:internal|ERR_MODULE/;
  const THROWS = 'throw new Error("boom-secret-detail");\n';

  describe.each(ENTRIES)("%s entry", (name, entry, handler, body) => {
    const payload = JSON.stringify(body);

    test("an intact copy still exits 0 with empty or JSON stdout", () => {
      const r = run(entry, payload);
      expect(r.status).toBe(0);
      if (r.stdout !== "") {
        expect(() => {
          JSON.parse(r.stdout);
        }).not.toThrow();
      }
      expect(r.stderr).toBe("");
    });

    // The main-guard cases matter on older Node (engines allows >= 24.0):
    // `import.meta.main` needs >= 24.2, so the failure path must not depend on
    // it or on main-guard.js, which may itself be the broken module.
    const loadFailures: readonly [string, string, string | null][] = [
      ["process-shell.js missing", "hooks/process-shell.js", null],
      ["main-guard.js missing", "hooks/main-guard.js", null],
      ["main-guard.js throws at import", "hooks/main-guard.js", THROWS],
      ["handler missing", handler, null],
      ["handler throws at import", handler, THROWS],
      ["process-shell.js throws at import", "hooks/process-shell.js", THROWS],
    ];

    test.each(loadFailures)(
      "%s: exit 0, empty stdout, one 'could not start' note, no stack",
      (_label, target, replacement) => {
        const file = join(copy, "dist", target);
        if (replacement === null) rmSync(file);
        else writeFileSync(file, replacement);
        const r = run(entry, payload);
        expect(r.status).toBe(0);
        expect(r.stdout).toBe("");
        expect(r.stderr).toBe(
          `m3l-claude-mentor: ${name}: could not start; ignored\n`,
        );
        expect(r.stderr).not.toMatch(noStack);
      },
    );

    const runFailures: readonly [string, string][] = [
      [
        "runHook throws synchronously",
        'export function runHook() { throw new Error("boom-secret-detail"); }\n',
      ],
      [
        "runHook returns a rejected promise",
        'export function runHook() { return Promise.reject(new Error("boom-secret-detail")); }\n',
      ],
    ];

    test.each(runFailures)(
      "%s: exit 0, empty stdout, one 'failed unexpectedly' note, no stack",
      (_label, replacement) => {
        writeFileSync(
          join(copy, "dist", "hooks/process-shell.js"),
          replacement,
        );
        const r = run(entry, payload);
        expect(r.status).toBe(0);
        expect(r.stdout).toBe("");
        expect(r.stderr).toBe(
          `m3l-claude-mentor: ${name}: failed unexpectedly; ignored\n`,
        );
        expect(r.stderr).not.toMatch(noStack);
      },
    );

    test("a broken entry that is only imported prints nothing and exits 0", () => {
      rmSync(join(copy, "dist", "hooks/process-shell.js"));
      const url = pathToFileURL(join(copy, "dist", entry)).href;
      const r = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", `await import(${JSON.stringify(url)});`],
        {
          encoding: "utf8",
          timeout: 30_000,
          env: {
            PATH: process.env["PATH"] ?? "",
            CLAUDE_PLUGIN_DATA: sb.dir,
          },
        },
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).not.toMatch(noStack);
    });
  });
});
