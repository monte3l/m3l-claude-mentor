#!/usr/bin/env node
/**
 * Fails when generated build output is committed. The plugin runs its
 * TypeScript directly (Node strips the types), so nothing is built and `dist/`
 * must never come back: OpenSSF Baseline OSPS-QA-05.01 says the version
 * control system must not contain generated executable artifacts.
 *
 * Two things are checked: no file under `dist/` and no `*.tsbuildinfo` is
 * tracked, and `.gitignore` still lists `dist/` so a stray build cannot be
 * added by accident.
 */
import process from "node:process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseJsonFlag, createReporter, repoRoot } from "./lib/report.mjs";

const root = repoRoot();
const reporter = createReporter(parseJsonFlag(process.argv.slice(2)));

const tracked = spawnSync(
  "git",
  ["ls-files", "--", "dist", "*.tsbuildinfo", "**/*.tsbuildinfo"],
  { cwd: root, encoding: "utf8" },
);
if (tracked.status !== 0) {
  reporter.fail(`git failed: ${tracked.stderr}`);
} else if (tracked.stdout.trim() === "") {
  reporter.ok("no build output is tracked");
} else {
  reporter.fail(
    `build output is tracked; the plugin runs src/*.ts directly, so remove it:\n${tracked.stdout}`,
  );
}

let ignore = "";
try {
  ignore = readFileSync(join(root, ".gitignore"), "utf8");
} catch {
  // A missing .gitignore is reported below.
}
if (/^\/?dist\/?\s*$/mu.test(ignore)) {
  reporter.ok(".gitignore lists dist/");
} else {
  reporter.fail(".gitignore does not list dist/");
}

reporter.finish();
