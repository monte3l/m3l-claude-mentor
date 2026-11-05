#!/usr/bin/env node
/**
 * Fails when the committed `dist/` differs from what `tsc` produces from
 * `src/`. The plugin's hooks and CLI run from `dist/` (a plugin installed
 * from git has no build step), so a stale `dist/` ships stale behavior.
 *
 * Rebuilds with `--force` so an incremental cache can never hide drift, then
 * asks git for any tracked change or untracked file under `dist/`.
 */
import process from "node:process";
import { spawnSync } from "node:child_process";
import { parseJsonFlag, createReporter, repoRoot } from "./lib/report.mjs";

const root = repoRoot();
const reporter = createReporter(parseJsonFlag(process.argv.slice(2)));

/** Runs a command in the repo root and returns its result. */
function run(cmd, args) {
  return spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
}

const build = run("pnpm", [
  "exec",
  "tsc",
  "-b",
  "--force",
  "tsconfig.build.json",
]);
if (build.status !== 0) {
  reporter.fail(
    `build failed, so dist/ freshness cannot be checked:\n${build.stdout}${build.stderr}`,
  );
  reporter.finish();
  process.exit(process.exitCode ?? 1);
}
reporter.ok("rebuilt dist/ from src/");

// Drift = the rebuilt tree differs from what git tracks (modified or deleted
// files) or the build emitted files git does not track yet. Comparing to the
// index, not HEAD, keeps freshly staged output from reading as stale.
const changed = run("git", ["diff", "--name-status", "--", "dist"]);
const untracked = run("git", [
  "ls-files",
  "--others",
  "--exclude-standard",
  "--",
  "dist",
]);
if (changed.status !== 0 || untracked.status !== 0) {
  reporter.fail(`git failed: ${changed.stderr}${untracked.stderr}`);
} else if (changed.stdout.trim() === "" && untracked.stdout.trim() === "") {
  reporter.ok("dist/ matches a fresh build");
} else {
  reporter.fail(
    `dist/ is stale or untracked -- run \`pnpm build\` and commit dist/:\n${changed.stdout}${untracked.stdout}`,
  );
}

reporter.finish();
