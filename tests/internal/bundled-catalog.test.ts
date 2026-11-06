import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { loadBundledCatalog } from "../../src/internal/bundled-catalog.js";
import { parseCatalog } from "../../src/internal/catalog.js";
import { MentorStateError } from "../../src/internal/errors.js";

function expectedEntries(): unknown {
  const raw: unknown = JSON.parse(
    readFileSync(
      new URL("../../data/topic-catalog.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCatalog(raw);
  if (!parsed.ok) throw new Error(`fixture invalid: ${parsed.reason}`);
  return parsed.value;
}

describe("loadBundledCatalog", () => {
  test("returns the validated entries of data/topic-catalog.json", async () => {
    const entries = await loadBundledCatalog();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toEqual(expectedEntries());
  });

  test("returns entries with unique ids and valid shapes", async () => {
    const entries = await loadBundledCatalog();
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of entries) {
      expect(typeof entry.title).toBe("string");
      expect(typeof entry.enabled).toBe("boolean");
    }
  });

  test("does not cache: each call yields a fresh array", async () => {
    const first = await loadBundledCatalog();
    const second = await loadBundledCatalog();
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});

const sandboxes: string[] = [];
afterEach(() => {
  for (const dir of sandboxes.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "m3l-bundled-"));
  sandboxes.push(dir);
  return dir;
}

function fileWith(content: string): URL {
  const file = join(sandbox(), "topic-catalog.json");
  writeFileSync(file, content);
  return pathToFileURL(file);
}

async function failure(source: URL): Promise<MentorStateError> {
  try {
    await loadBundledCatalog(source);
  } catch (error) {
    if (error instanceof MentorStateError) return error;
    throw error;
  }
  throw new Error("expected loadBundledCatalog to reject");
}

const realText = readFileSync(
  new URL("../../data/topic-catalog.json", import.meta.url),
  "utf8",
);

describe("loadBundledCatalog with a source URL", () => {
  test("loads a valid catalog from the given file", async () => {
    const entries = await loadBundledCatalog(fileWith(realText));
    expect(entries).toEqual(expectedEntries());
  });

  test("a missing file is READ_FAILED", async () => {
    const url = pathToFileURL(join(sandbox(), "absent.json"));
    expect((await failure(url)).code).toBe("READ_FAILED");
  });

  test("a directory in place of the file is READ_FAILED", async () => {
    const dir = join(sandbox(), "topic-catalog.json");
    mkdirSync(dir);
    expect((await failure(pathToFileURL(dir))).code).toBe("READ_FAILED");
  });

  test("invalid JSON is PARSE_FAILED, without cause or file text", async () => {
    const error = await failure(fileWith("{not json SECRET-FILE-TEXT"));
    expect(error.code).toBe("PARSE_FAILED");
    expect(error.cause).toBeUndefined();
    expect(error.message).not.toContain("SECRET-FILE-TEXT");
  });

  test("valid JSON the parser rejects is VALIDATION_FAILED", async () => {
    const error = await failure(fileWith('{"not":"an array"}'));
    expect(error.code).toBe("VALIDATION_FAILED");
  });

  test("a file of exactly 1,048,576 bytes is accepted", async () => {
    const text = realText.trimEnd();
    const padded = text + " ".repeat(1_048_576 - Buffer.byteLength(text));
    expect(Buffer.byteLength(padded)).toBe(1_048_576);
    expect(await loadBundledCatalog(fileWith(padded))).toEqual(
      expectedEntries(),
    );
  });

  test("a file of 1,048,577 bytes is TOO_LARGE", async () => {
    const text = realText.trimEnd();
    const padded = text + " ".repeat(1_048_577 - Buffer.byteLength(text));
    expect(Buffer.byteLength(padded)).toBe(1_048_577);
    expect((await failure(fileWith(padded))).code).toBe("TOO_LARGE");
  });
});
