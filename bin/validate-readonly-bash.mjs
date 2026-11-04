#!/usr/bin/env node
/**
 * PreToolUse validator (Bash), wired through the frontmatter `hooks` field of the two
 * read-only review spokes (`code-reviewer`, `silent-failure-hunter`). Those
 * agents are granted `Bash` so they can run `git diff`, `grep` and the test
 * gates, but a `tools` list cannot allow Bash minus its writing commands, so
 * this hook is the backstop: it blocks a command that visibly writes.
 *
 * Blocks (exit 2, reason on stderr): output redirection to a file (anything
 * but `/dev/null` or a `2>&1`-style descriptor merge), `tee`, `sed -i`,
 * `rm`/`mv`/`cp`/`mkdir`/`touch`/`chmod`/`ln`, mutating `git` subcommands,
 * formatter/fixer flags (`--write`, `--fix`), and package-manager install,
 * add, remove, update and `format` runs.
 *
 * This is a conservative denylist, not a shell parser: it cannot see an
 * interpreter that writes from inside a script, an `eval`, or a computed
 * path. It raises the bar for a reviewer that drifts into editing; it is not
 * a proof. Fail-open on a malformed payload or a missing command (exit 0).
 */
import process from "node:process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GIT_MUTATING = new Set([
  "add",
  "commit",
  "push",
  "pull",
  "fetch",
  "merge",
  "rebase",
  "reset",
  "restore",
  "checkout",
  "switch",
  "rm",
  "mv",
  "clean",
  "stash",
  "cherry-pick",
  "revert",
  "apply",
  "am",
  "tag",
  "branch",
  "worktree",
  "gc",
]);

const WRITING_COMMANDS =
  /(?:^|[;&|(]\s*)(?:tee|rm|mv|cp|mkdir|touch|chmod|ln)\b/;

/**
 * Why `command` writes, or `undefined` if nothing in it visibly does.
 * @param {string} command
 */
export function writeReason(command) {
  // Strip descriptor merges (`2>&1`) and `/dev/null` sinks before looking
  // for a file redirect.
  const stripped = command
    .replace(/\d*>&\d+/g, "")
    .replace(/\d*>>?\s*\/dev\/null/g, "");
  if (/(^|[^<>=-])>{1,2}\s*[^\s>&]/.test(stripped)) {
    return "it redirects output to a file";
  }
  if (WRITING_COMMANDS.test(command)) return "it uses a writing command";
  if (/\bsed\b[^|;&]*\s-[a-zA-Z]*i/.test(command)) return "it runs `sed -i`";
  if (/(^|[\s=])--(?:write|fix)\b/.test(command)) {
    return "it passes a formatter/fixer write flag";
  }
  const git = /\bgit\s+(?:-[^\s]+\s+|-C\s+\S+\s+)*([a-z-]+)/.exec(command);
  if (git !== null && git[1] !== undefined && GIT_MUTATING.has(git[1])) {
    return `it runs the mutating \`git ${git[1]}\``;
  }
  if (
    /\b(?:pnpm|npm|yarn)\s+(?:install|i|add|remove|rm|update|up|format|dedupe)\b/.test(
      command,
    )
  ) {
    return "it changes dependencies or formats files";
  }
  return undefined;
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    process.exit(0);
  }
  const command = input?.tool_input?.command;
  if (typeof command !== "string") process.exit(0);
  const reason = writeReason(command);
  if (reason !== undefined) {
    process.stderr.write(
      `validate-readonly-bash: blocked -- ${reason}. This agent is read-only; report the finding instead of changing files.\n`,
    );
    process.exit(2);
  }
  process.exit(0);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) await main();
