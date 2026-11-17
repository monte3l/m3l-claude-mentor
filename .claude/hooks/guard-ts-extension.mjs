#!/usr/bin/env node
/**
 * PreToolUse guard (Write|Edit): blocks writing a relative import in a
 * TypeScript file that does not end in `.ts`.
 *
 * The plugin ships no build output: Node runs `src/*.ts` directly by
 * stripping the types, and Node resolves a relative import by its real file
 * name. So `./x` and `./x.js` both type-check under the right tsconfig but
 * fail at runtime, because neither file exists. Path-scoped rules load on
 * Read, Write and Edit (Claude Code 2.1.288) but only advise, so this runs
 * as a hook, which blocks.
 *
 * Blocks by exiting 2 with a message on stderr (Claude Code convention).
 */
import process from "node:process";

const ALLOWED = [".ts", ".mts", ".cts", ".mjs", ".cjs", ".json", ".node"];

/** Extract the content being written from the tool input. */
function contentToCheck(input) {
  const ti = input.tool_input ?? {};
  // Write -> content; Edit -> new_string (the text being introduced).
  return [ti.content, ti.new_string].filter((s) => typeof s === "string");
}

/** Find relative import/export specifiers without an allowed extension (`.js` is not one). */
function offendingSpecifiers(source) {
  const offenders = [];
  // Matches: from "./x", from '../y', import("./z"), require("./w")
  const re = /\b(?:from|import|require)\s*\(?\s*["'](\.\.?\/[^"']*)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const spec = m[1];
    const hasAllowed = ALLOWED.some((ext) => spec.endsWith(ext));
    if (!hasAllowed) offenders.push(spec);
  }
  return offenders;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const raw = await readStdin();
let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0); // Not our concern; let the call through.
}

const filePath = input.tool_input?.file_path ?? "";
if (!/\.(ts|tsx|mts|cts)$/.test(filePath)) process.exit(0);

const offenders = contentToCheck(input).flatMap(offendingSpecifiers);
if (offenders.length > 0) {
  const unique = [...new Set(offenders)];
  const fix = (s) => (s.endsWith(".js") ? `${s.slice(0, -3)}.ts` : `${s}.ts`);
  process.stderr.write(
    `Blocked: relative import(s) without the required \`.ts\` extension ` +
      `(Node runs src/*.ts directly and will fail to resolve them at runtime):\n` +
      unique.map((s) => `  - "${s}"  ->  "${fix(s)}"`).join("\n") +
      `\nEnd every relative import in a TypeScript file with \`.ts\`.\n`,
  );
  process.exit(2);
}

process.exit(0);
