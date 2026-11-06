import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { isMainModule } from "../../src/hooks/main-guard.js";

const sandboxes: string[] = [];
afterEach(() => {
  for (const dir of sandboxes.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "m3l-main-guard-"));
  sandboxes.push(dir);
  return dir;
}

function moduleFile(): { file: string; url: string; dir: string } {
  const dir = sandbox();
  const file = join(dir, "entry.js");
  writeFileSync(file, "export {};\n");
  return { file, url: pathToFileURL(file).href, dir };
}

describe("isMainModule with import.meta.main", () => {
  test.each([true, false])("returns the boolean %s as given", (main) => {
    const { url } = moduleFile();
    // argv1 contradicts the flag when main is false, so the flag must win.
    expect(isMainModule({ url, main }, main ? undefined : fileOf(url))).toBe(
      main,
    );
  });
});

function fileOf(url: string): string {
  return new URL(url).pathname;
}

describe("isMainModule fallback (main not a boolean)", () => {
  test.each([
    ["absent", {}],
    ["undefined", { main: undefined }],
  ] as const)(
    "main %s: argv1 equal to the module path is true",
    (_n, extra) => {
      const { file, url } = moduleFile();
      expect(isMainModule({ url, ...extra }, file)).toBe(true);
    },
  );

  test("a symlink to the module counts as the module", () => {
    const { file, url, dir } = moduleFile();
    const link = join(dir, "link.js");
    symlinkSync(file, link);
    expect(isMainModule({ url }, link)).toBe(true);
  });

  test("the module reached through a symlinked url is matched by its real path", () => {
    const { file, dir } = moduleFile();
    const link = join(dir, "link.js");
    symlinkSync(file, link);
    expect(isMainModule({ url: pathToFileURL(link).href }, file)).toBe(true);
  });

  test("a different existing file is false", () => {
    const { url, dir } = moduleFile();
    const other = join(dir, "other.js");
    writeFileSync(other, "export {};\n");
    expect(isMainModule({ url }, other)).toBe(false);
  });

  test("argv1 undefined is false", () => {
    const { url } = moduleFile();
    expect(isMainModule({ url }, undefined)).toBe(false);
  });

  test("a nonexistent argv1 is false and does not throw", () => {
    const { url, dir } = moduleFile();
    expect(isMainModule({ url }, join(dir, "absent.js"))).toBe(false);
  });

  test("a module url whose file is gone is false and does not throw", () => {
    const { file, url } = moduleFile();
    rmSync(file);
    expect(isMainModule({ url }, file)).toBe(false);
  });

  test("a non-file url is false and does not throw", () => {
    const { file } = moduleFile();
    expect(isMainModule({ url: "https://example.com/x.js" }, file)).toBe(false);
  });

  test("a directory argv1 is false", () => {
    const { url, dir } = moduleFile();
    const sub = join(dir, "sub");
    mkdirSync(sub);
    expect(isMainModule({ url }, sub)).toBe(false);
  });
});
