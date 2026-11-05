import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const hookPath = (name: string): string =>
  fileURLToPath(new URL(`../../.claude/hooks/${name}.mjs`, import.meta.url));

interface HookResult {
  readonly status: number | null;
  readonly stderr: string;
}

// Per-test sandbox so nothing touches the real repo.
let sandbox = "";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "write-guards-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Run a hook with `stdin` (object is JSON-encoded, string is sent raw). */
function runHook(name: string, stdin: unknown): HookResult {
  const input = typeof stdin === "string" ? stdin : JSON.stringify(stdin);
  const result = spawnSync(process.execPath, [hookPath(name)], {
    input,
    encoding: "utf8",
    timeout: 20_000,
    env: { PATH: process.env["PATH"] ?? "", CLAUDE_PROJECT_DIR: sandbox },
  });
  return { status: result.status, stderr: result.stderr };
}

const write = (filePath: string, content: string): unknown => ({
  tool_name: "Write",
  tool_input: { file_path: filePath, content },
});

const edit = (filePath: string, newString: string): unknown => ({
  tool_name: "Edit",
  tool_input: { file_path: filePath, old_string: "x", new_string: newString },
});

// Fixture shapes are assembled at runtime so this file's own source never
// contains the constructs the repo's write-time guards block.
const FROM = ["fr", "om"].join("");
const IMPORT = ["imp", "ort"].join("");
const REQUIRE = ["req", "uire"].join("");
const MODULE_EXPORTS = ["module", ".exports"].join("");
const EXPORTS_DOT = ["exports", "."].join("");
const DIRNAME = ["__", "dirname"].join("");
const FILENAME = ["__", "filename"].join("");
const named = (spec: string): string => `${IMPORT} { x } ${FROM} "${spec}";`;

const EXT_REASON = "missing the required `.js` extension";

describe("guard-js-extension", () => {
  const hook = "guard-js-extension";

  test("blocks a relative import missing .js in a Write", () => {
    const r = runHook(hook, write("/p/src/a.ts", named("./x")));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(EXT_REASON);
    expect(r.stderr).toContain('"./x"');
  });

  test("blocks a missing extension introduced via Edit new_string", () => {
    const r = runHook(hook, edit("/p/src/a.ts", `export * ${FROM} "../y";`));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(EXT_REASON);
    expect(r.stderr).toContain('"../y"');
  });

  test("allows a relative import ending in .js", () => {
    const r = runHook(hook, write("/p/src/a.ts", named("./x.js")));
    expect(r).toEqual({ status: 0, stderr: "" });
  });

  test.each([".mjs", ".cjs", ".json", ".node"])(
    "allows the %s extension",
    (ext) => {
      const r = runHook(hook, write("/p/src/a.ts", named(`./a${ext}`)));
      expect(r).toEqual({ status: 0, stderr: "" });
    },
  );

  test("allows bare package specifiers and type-only imports with .js", () => {
    const r = runHook(
      hook,
      write(
        "/p/src/a.ts",
        `${named("zod")}\n${IMPORT} type { T } ${FROM} "./t.js";`,
      ),
    );
    expect(r).toEqual({ status: 0, stderr: "" });
  });

  test("blocks a type-only import missing .js", () => {
    const r = runHook(
      hook,
      write("/p/src/a.ts", `${IMPORT} type { T } ${FROM} "./t";`),
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(EXT_REASON);
    expect(r.stderr).toContain('"./t"');
  });

  test("blocks a dynamic import missing .js", () => {
    const r = runHook(
      hook,
      write("/p/src/a.ts", `const m = await ${IMPORT}("./lazy");`),
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(EXT_REASON);
    expect(r.stderr).toContain('"./lazy"');
  });

  test("ignores files that are not TypeScript sources", () => {
    const r = runHook(hook, write("/p/README.md", named("./x")));
    expect(r).toEqual({ status: 0, stderr: "" });
  });

  test("fails open on malformed JSON and missing fields", () => {
    expect(runHook(hook, "{not json").status).toBe(0);
    expect(runHook(hook, {}).status).toBe(0);
    expect(runHook(hook, { tool_input: { file_path: "/p/a.ts" } }).status).toBe(
      0,
    );
  });
});

describe("guard-no-commonjs", () => {
  const hook = "guard-no-commonjs";

  test("blocks a CommonJS require call in TypeScript source", () => {
    const r = runHook(
      hook,
      write("/p/src/a.ts", `const fs = ${REQUIRE}("fs");`),
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`${REQUIRE}(...)`);
  });

  test.each([
    {
      name: "module exports",
      code: `${MODULE_EXPORTS} = {};`,
      label: MODULE_EXPORTS,
    },
    {
      name: "exports property",
      code: `${EXPORTS_DOT}foo = 1;`,
      label: "exports.<name>",
    },
    { name: "dirname global", code: `const d = ${DIRNAME};`, label: DIRNAME },
    {
      name: "filename global",
      code: `const f = ${FILENAME};`,
      label: FILENAME,
    },
  ])("blocks the $name construct", ({ code, label }) => {
    const r = runHook(hook, edit("/p/src/a.ts", code));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("CommonJS construct(s) found");
    expect(r.stderr).toContain(label);
  });

  test("allows ESM source", () => {
    const r = runHook(
      hook,
      write(
        "/p/src/a.ts",
        `${named("./a.js")}\nexport const b = ${IMPORT}.meta.dirname;`,
      ),
    );
    expect(r).toEqual({ status: 0, stderr: "" });
  });

  test("does not flag a kebab-case *-exports.<ext> filename mention", () => {
    const r = runHook(
      hook,
      write("/p/src/a.ts", "// see check-doc-exports.mjs"),
    );
    expect(r).toEqual({ status: 0, stderr: "" });
  });

  test("exempts files under .claude/hooks/ and non-source extensions", () => {
    const code = `${MODULE_EXPORTS} = {};`;
    expect(runHook(hook, write("/p/.claude/hooks/h.mjs", code))).toEqual({
      status: 0,
      stderr: "",
    });
    expect(runHook(hook, write("/p/notes.md", code))).toEqual({
      status: 0,
      stderr: "",
    });
  });

  test("fails open on malformed JSON and missing fields", () => {
    expect(runHook(hook, "").status).toBe(0);
    expect(runHook(hook, "{not json").status).toBe(0);
    expect(runHook(hook, {}).status).toBe(0);
  });
});

describe("guard-secret-writes", () => {
  const hook = "guard-secret-writes";
  const realisticValue = ["q7Zk", "Lm3V", "b9Xw", "T2Rp", "a8Nd"].join("");
  const awsKeyId = ["AK", "IA", "ABCDEFGH", "JKLMNOPQ"].join("");
  const tokenKey = ["GITHUB", "_TOKEN"].join("");

  test("blocks writing a real dotenv file", () => {
    const r = runHook(hook, write(join(sandbox, ".env"), "FOO=bar"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("dotenv secret file");
  });

  test("blocks .env.local", () => {
    const r = runHook(hook, write(join(sandbox, ".env.local"), "A=1"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("dotenv secret file (.env.local)");
  });

  test("allows a .env.example template", () => {
    const r = runHook(hook, write(join(sandbox, ".env.example"), "A=1"));
    expect(r).toEqual({ status: 0, stderr: "" });
  });

  test("blocks a secret key assigned a literal value", () => {
    const content = ["NPM", "_TOKEN"].join("") + "=" + realisticValue;
    const r = runHook(hook, write(join(sandbox, "ci.txt"), content));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("NPM_TOKEN assigned a literal value");
  });

  test("blocks a recognised AWS access key id literal via Edit", () => {
    const r = runHook(
      hook,
      edit(join(sandbox, "cfg.ts"), `const k = "${awsKeyId}";`),
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("recognised token/key literal");
  });

  test.each([
    ["a CI secret reference", `${tokenKey}: \${{ secrets.${tokenKey} }}`],
    ["an env reference", `${tokenKey}=process.env.${tokenKey}`],
    ["an angle-bracket placeholder", `${tokenKey}=<your-token>`],
    ["a too-short value", `${tokenKey}=short`],
  ])("allows %s", (_name, content) => {
    const r = runHook(hook, write(join(sandbox, "w.yml"), content));
    expect(r).toEqual({ status: 0, stderr: "" });
  });

  test("fails open on malformed JSON, missing file_path and no content", () => {
    expect(runHook(hook, "{not json").status).toBe(0);
    expect(runHook(hook, {}).status).toBe(0);
    expect(runHook(hook, { tool_input: { content: awsKeyId } }).status).toBe(0);
    expect(
      runHook(hook, { tool_input: { file_path: join(sandbox, "a.ts") } })
        .status,
    ).toBe(0);
  });
});

describe("guard-protected-paths", () => {
  const hook = "guard-protected-paths";

  test.each(["dist/index.js", "coverage/lcov.info", "/p/dist/a/b.js"])(
    "blocks an edit to %s",
    (filePath) => {
      const r = runHook(hook, write(filePath, "x"));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("is generated output");
    },
  );

  test("allows ordinary source paths", () => {
    const r = runHook(hook, write("/p/src/index.ts", "x"));
    expect(r).toEqual({ status: 0, stderr: "" });
  });

  test.each(["/p/distro/a.ts", "/p/mydist/a.ts", "/p/src/dist.ts"])(
    "matches whole directory names only (%s allowed)",
    (filePath) => {
      const r = runHook(hook, write(filePath, "x"));
      expect(r).toEqual({ status: 0, stderr: "" });
    },
  );

  test("fails open on malformed JSON and missing file_path", () => {
    expect(runHook(hook, "not json").status).toBe(0);
    expect(runHook(hook, {}).status).toBe(0);
    expect(runHook(hook, { tool_input: {} }).status).toBe(0);
  });
});
