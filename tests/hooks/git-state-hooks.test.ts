import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.setConfig({ testTimeout: 15_000 });

// HOOK_TEST_ROOT lets a mutated copy of .claude/hooks + bin/lib be exercised
// (mutation testing) without ever editing the real hooks.
const OVERRIDE = process.env["HOOK_TEST_ROOT"];
if (OVERRIDE !== undefined && process.env["CI"]) {
  throw new Error("HOOK_TEST_ROOT must not be set in CI");
}
if (OVERRIDE !== undefined) {
  console.warn(`git-state-hooks: hooks redirected to ${OVERRIDE}`);
}
const ROOT = OVERRIDE ?? fileURLToPath(new URL("../../", import.meta.url));
const hook = (name: string): string =>
  join(ROOT, ".claude", "hooks", `${name}.mjs`);

/**
 * Sanitized env: git exports GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE etc. to
 * hook processes, which would aim fixture git calls at the real repo.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CEILING_DIRECTORIES: realpathSync(tmpdir()),
  };
}

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "git-state-hooks-"));
  dirs.push(d);
  return d;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: cleanEnv(),
  }).trim();
}

/** Feature branch carrying one unsigned commit not on main, signing then on. */
function makeUnsignedFeatureRepo(): string {
  const repo = makeRepo();
  git(repo, "switch", "-c", "feat/x");
  writeFileSync(join(repo, "b.txt"), "b\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "unsigned");
  git(repo, "config", "commit.gpgsign", "true");
  return repo;
}

/** Throwaway repo on `main` with one unsigned commit and signing off. */
function makeRepo(): string {
  const dir = tempDir();
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "x\n");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "init");
  return dir;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(name: string, input: string, cwd: string): Run {
  const r = spawnSync(process.execPath, [hook(name)], {
    input,
    encoding: "utf8",
    cwd,
    env: { ...cleanEnv(), CLAUDE_PROJECT_DIR: cwd },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("guard-branch-isolation", () => {
  const write = (cwd: string, file: string): Run =>
    run(
      "guard-branch-isolation",
      JSON.stringify({ tool_name: "Write", tool_input: { file_path: file } }),
      cwd,
    );

  test("blocks a src write while HEAD is on main", () => {
    const repo = makeRepo();
    const r = write(repo, join(repo, "src", "a.ts"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Blocked");
    expect(r.stderr).toContain("`main`");
  });

  test("blocks a tests write while HEAD is on main", () => {
    const repo = makeRepo();
    {
      const r = write(repo, join(repo, "tests", "a.test.ts"));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("Blocked");
    }
  });

  test("blocks a write into a not-yet-existing nested src directory on main", () => {
    const repo = makeRepo();
    expect(write(repo, join(repo, "src", "new", "deep", "a.ts")).status).toBe(
      2,
    );
  });

  test("allows a src write on a feature branch", () => {
    const repo = makeRepo();
    git(repo, "switch", "-c", "feat/x");
    const r = write(repo, join(repo, "src", "a.ts"));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("allows a write outside src/tests while on main", () => {
    const repo = makeRepo();
    expect(write(repo, join(repo, "docs", "a.md")).status).toBe(0);
  });

  test("never blocks in a non-git directory", () => {
    const dir = tempDir();
    expect(write(dir, join(dir, "src", "a.ts")).status).toBe(0);
  });

  test("blocks when HEAD is detached on the main commit", () => {
    const repo = makeRepo();
    git(repo, "checkout", "--detach");
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
    {
      const r = write(repo, join(repo, "src", "a.ts"));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("Blocked");
    }
  });

  test("allows when HEAD is detached on a commit other than main", () => {
    const repo = makeRepo();
    git(repo, "switch", "-c", "feat/x");
    writeFileSync(join(repo, "b.txt"), "b\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "second");
    git(repo, "checkout", "--detach");
    expect(write(repo, join(repo, "src", "a.ts")).status).toBe(0);
  });

  test("resolves the branch from the file's repo, not the cwd", () => {
    const onMain = makeRepo();
    const onFeature = makeRepo();
    git(onFeature, "switch", "-c", "feat/x");
    // cwd is the feature repo, the file lives in the repo on main
    {
      const r = write(onFeature, join(onMain, "src", "a.ts"));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("Blocked");
    }
    // cwd is the main repo, the file lives in the feature repo
    expect(write(onMain, join(onFeature, "src", "a.ts")).status).toBe(0);
  });

  test.each(["not json", ""])("fails open on malformed JSON %j", (raw) => {
    const repo = makeRepo();
    expect(run("guard-branch-isolation", raw, repo).status).toBe(0);
  });
});

describe("guard-git-push-signed", () => {
  const bash = (cwd: string, command: unknown): Run =>
    run(
      "guard-git-push-signed",
      JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      cwd,
    );

  test("blocks a push of unsigned commits when commit.gpgsign is on", () => {
    const repo = makeUnsignedFeatureRepo();
    const r = bash(repo, "git push origin feat/x");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unsigned");
    expect(r.stderr).toContain("%G? = N");
  });

  test("blocks a push chained after another command", () => {
    const repo = makeUnsignedFeatureRepo();
    {
      const r = bash(repo, "echo hi && git -C . push");
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("[guard-git-push-signed] Blocked");
    }
  });

  test("allows a push when commit.gpgsign is off", () => {
    const repo = makeUnsignedFeatureRepo();
    git(repo, "config", "commit.gpgsign", "false");
    expect(bash(repo, "git push origin feat/x").status).toBe(0);
  });

  test("allows a dry-run push even with signing on", () => {
    const repo = makeUnsignedFeatureRepo();
    expect(bash(repo, "git push --dry-run origin feat/x").status).toBe(0);
  });

  test.each(["git status", "git commit -m push", ""])(
    "allows a non-push command %j even with signing on",
    (command) => {
      const repo = makeUnsignedFeatureRepo();
      expect(bash(repo, command).status).toBe(0);
    },
  );

  test("allows a non-string command (fails open)", () => {
    const repo = makeUnsignedFeatureRepo();
    expect(bash(repo, 42).status).toBe(0);
  });

  test("fails open on a malformed payload", () => {
    const repo = makeUnsignedFeatureRepo();
    expect(run("guard-git-push-signed", "not json", repo).status).toBe(0);
  });
});

describe("inject-decision-gate", () => {
  const prompt = (cwd: string, text: string): Run =>
    run("inject-decision-gate", JSON.stringify({ prompt: text }), cwd);

  function context(r: Run): string {
    const out: unknown = JSON.parse(r.stdout);
    expect(out).toHaveProperty(
      "hookSpecificOutput.hookEventName",
      "UserPromptSubmit",
    );
    expect(out).toHaveProperty("hookSpecificOutput.additionalContext");
    const ctx = (out as { hookSpecificOutput: { additionalContext: unknown } })
      .hookSpecificOutput.additionalContext;
    expect(typeof ctx).toBe("string");
    return ctx as string;
  }

  test("on main, emits valid JSON naming main and the starting-work decisions", () => {
    const repo = makeRepo();
    const r = prompt(repo, "implement the login feature");
    expect(r.status).toBe(0);
    const ctx = context(r);
    expect(ctx).toContain("on `main`");
    expect(ctx).toContain("starting-work");
    expect(ctx).toContain("Branch");
    expect(ctx).toContain("PR");
    expect(ctx).toContain("HEAD may be on/at `main`");
  });

  test("on a feature branch, the context names that branch and omits the main warning", () => {
    const repo = makeRepo();
    git(repo, "switch", "-c", "feat/x");
    const r = prompt(repo, "fix the lint errors");
    expect(r.status).toBe(0);
    const ctx = context(r);
    expect(ctx).toContain("on `feat/x`");
    expect(ctx).not.toContain("HEAD may be on/at `main`");
  });

  test("on a detached HEAD, the context says so", () => {
    const repo = makeRepo();
    git(repo, "checkout", "--detach");
    expect(context(prompt(repo, "refactor the parser"))).toContain(
      "detached HEAD",
    );
  });

  test("outside a git repo, it still injects and exits 0", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "w"));
    const r = prompt(join(dir, "w"), "add a command");
    expect(r.status).toBe(0);
    expect(context(r)).toContain("not a git repo");
  });

  test.each([
    "what does this hook do?",
    "how do I build the project",
    "hello there",
    "",
  ])("stays silent on a non-change prompt %j", (text) => {
    const repo = makeRepo();
    const r = prompt(repo, text);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("stays silent and exits 0 on malformed JSON", () => {
    const repo = makeRepo();
    const r = run("inject-decision-gate", "not json", repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("fixture isolation", () => {
  test("an inherited GIT_DIR/GIT_WORK_TREE cannot redirect fixture git or hooks", () => {
    const bogus = join(tmpdir(), "does-not-exist-git-dir");
    vi.stubEnv("GIT_DIR", bogus);
    vi.stubEnv("GIT_WORK_TREE", bogus);
    vi.stubEnv("GIT_INDEX_FILE", join(bogus, "index"));
    try {
      const repo = makeRepo();
      expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
      const r = run(
        "guard-branch-isolation",
        JSON.stringify({
          tool_input: { file_path: join(repo, "src", "a.ts") },
        }),
        repo,
      );
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("Blocked");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
