// SPDX-FileCopyrightText: 2026 Enrico Lionello (enri3l), Giulia Montevecchi (giulmonte), monte3l
// SPDX-License-Identifier: MIT

// Fails when the documentation and the code disagree: the skills the README
// and DESIGN.md list against skills/, the README settings table against the
// manifest's userConfig (names and defaults), and the Node version the README
// names against .node-version.
//
// The docs kit runs this as a parity module (docs.config.mjs `parity`), so
// `node design/source/docs-kit/build.mjs --check` covers it. Standalone:
// `node scripts/doc-parity.mjs` prints ok or the drift and exits 1.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertSame,
  assertSameSet,
  codeSpans,
  section,
  tableColumn,
} from "../design/source/docs-kit/lib/parity.mjs";

const read = (root, path) => readFileSync(join(root, path), "utf8");

/** Names of the skill directories under skills/. */
export const skillNames = (root) =>
  readdirSync(join(root, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

/** Skill names a DESIGN.md section writes as `/m3l-claude-mentor:<name>`. */
export const designSkillNames = (text) => [
  ...new Set(
    [...text.matchAll(/\/m3l-claude-mentor:([a-z][a-z-]*)/g)].map(
      (match) => match[1],
    ),
  ),
];

/** Returns one message per drift; empty when the documentation matches the code. */
export default function check({ root }) {
  const problems = [];
  const readme = read(root, "README.md");
  const design = read(root, "DESIGN.md");
  const manifest = JSON.parse(read(root, ".claude-plugin/plugin.json"));
  const skills = skillNames(root);

  const skillsSection = section(readme, "Skills");
  if (skillsSection === null) problems.push("README has no Skills section");
  else {
    problems.push(
      ...assertSameSet(
        "README skills table",
        tableColumn(skillsSection, "Skill").flatMap(codeSpans),
        skills,
      ),
    );
  }

  const lessons = section(design, "7. On-demand lessons and reference");
  if (lessons === null) problems.push("DESIGN.md has no section 7");
  else {
    problems.push(
      ...assertSameSet(
        "DESIGN.md section 7 skills",
        designSkillNames(lessons),
        skills,
      ),
    );
  }

  const options = manifest.userConfig ?? {};
  const settings = section(readme, "Settings");
  if (settings === null) problems.push("README has no Settings section");
  else {
    const names = tableColumn(settings, "Option").flatMap(codeSpans);
    problems.push(
      ...assertSameSet("README settings", names, Object.keys(options)),
    );
    const defaults = tableColumn(settings, "Default");
    tableColumn(settings, "Option")
      .map((cell) => codeSpans(cell)[0])
      .forEach((name, index) => {
        if (name in options) {
          problems.push(
            ...assertSame(
              `README default for ${name}`,
              defaults[index],
              String(options[name].default),
            ),
          );
        }
      });
  }

  const nodeMajor = read(root, ".node-version").trim().split(".")[0];
  if (!new RegExp(`\\(${nodeMajor}\\)`).test(readme)) {
    problems.push(
      `README Requirements does not name the .node-version major (${nodeMajor})`,
    );
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const problems = check({ root });
  if (problems.length === 0) console.log("doc-parity: ok");
  else {
    for (const problem of problems) console.error(`doc-parity: ${problem}`);
    process.exit(1);
  }
}
