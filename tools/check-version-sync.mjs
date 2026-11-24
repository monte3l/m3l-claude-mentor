#!/usr/bin/env node
/**
 * Fails when `.claude-plugin/plugin.json` and `package.json` declare
 * different versions. The plugin manifest is what users install; the
 * package.json version is what release tooling bumps, so they must agree.
 */
import process from "node:process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonFlag, createReporter, repoRoot } from "./lib/report.mjs";

const root = repoRoot();
const reporter = createReporter(parseJsonFlag(process.argv.slice(2)));

/** Reads a JSON file's `version`, reporting a failure and returning undefined. */
function readVersion(relativePath) {
  try {
    const parsed = JSON.parse(readFileSync(join(root, relativePath), "utf8"));
    if (typeof parsed.version !== "string") {
      reporter.fail(`${relativePath} has no string "version"`);
      return undefined;
    }
    return parsed.version;
  } catch (error) {
    reporter.fail(`${relativePath} cannot be read: ${error.message}`);
    return undefined;
  }
}

const pkg = readVersion("package.json");
const manifest = readVersion(".claude-plugin/plugin.json");

if (pkg !== undefined && manifest !== undefined) {
  if (pkg === manifest) {
    reporter.ok(`package.json and plugin.json agree on ${pkg}`);
  } else {
    reporter.fail(
      `version mismatch: package.json is ${pkg}, plugin.json is ${manifest}`,
    );
  }
}

reporter.finish();
