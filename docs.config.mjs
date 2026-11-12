// SPDX-FileCopyrightText: 2026 Enrico Lionello (enri3l), Giulia Montevecchi (giulmonte), monte3l
// SPDX-License-Identifier: MIT

// Docs kit config. The kit is design/source/docs-kit/ (vendored from m3l-design);
// its README documents every key. Every tracked *.md file must be a page or be
// excluded with a reason, or `node design/source/docs-kit/build.mjs --check` fails.
export default {
  title: "m3l-claude-mentor",
  repo: "https://github.com/monte3l/m3l-claude-mentor",
  siteUrl: "https://claude-mentor.monte3l.com",
  designDir: "design",
  brand: true,
  manifest: ".claude-plugin/plugin.json", // its homepage must equal siteUrl
  navGroups: ["Start", "Reference", "Project", "Security"],
  pages: [
    { src: "README.md", out: "index.html", group: "Start", label: "Overview" },
    {
      src: "skills/teach/SKILL.md",
      out: "skill-teach.html",
      group: "Reference",
      label: "Teach skill prompt",
    },
    {
      src: "skills/ask/SKILL.md",
      out: "skill-ask.html",
      group: "Reference",
      label: "Ask skill prompt",
    },
    {
      src: "skills/quiz/SKILL.md",
      out: "skill-quiz.html",
      group: "Reference",
      label: "Quiz skill prompt",
    },
    {
      src: "skills/whats-new/SKILL.md",
      out: "skill-whats-new.html",
      group: "Reference",
      label: "What's new skill prompt",
    },
    {
      src: "skills/assess/SKILL.md",
      out: "skill-assess.html",
      group: "Reference",
      label: "Assess skill prompt",
    },
    {
      src: "skills/profile/SKILL.md",
      out: "skill-profile.html",
      group: "Reference",
      label: "Profile skill prompt",
    },
    {
      src: "agents/docs-researcher.md",
      out: "agent-docs-researcher.html",
      group: "Reference",
      label: "Docs researcher agent",
    },
    {
      src: "agents/mastery-assessor.md",
      out: "agent-mastery-assessor.html",
      group: "Reference",
      label: "Mastery assessor agent",
    },
    {
      src: "output-styles/mentor.md",
      out: "output-style.html",
      group: "Reference",
      label: "Mentor output style",
    },
    {
      src: "DESIGN.md",
      out: "DESIGN.html",
      group: "Project",
      label: "Design spec",
    },
    {
      src: "design/README.md",
      out: "design.html",
      group: "Project",
      label: "Design system",
    },
    {
      src: "SECURITY.md",
      out: "SECURITY.html",
      group: "Security",
      label: "Security policy",
    },
  ],
  exclude: [
    {
      glob: "CHANGELOG.md",
      reason: "release notes live on the GitHub releases page",
    },
    {
      glob: "CLAUDE.md",
      reason: "instructions for coding agents, not reader-facing",
    },
    {
      glob: ".claude/**",
      reason: "instructions for coding agents, not reader-facing",
    },
    {
      glob: "docs/research/**",
      reason: "living guidance trackers for maintainers, not reader-facing",
    },
    {
      glob: "skills/profile/references/**",
      reason:
        "reference files the profile skill loads on demand, not standalone pages",
    },
    {
      glob: "skills/teach/references/**",
      reason:
        "reference files the teach skill loads on demand, not standalone pages",
    },
    {
      glob: "design/source/**",
      reason:
        "vendored m3l-design release, never edited here; the kit and brand book are documented upstream",
    },
  ],
  parity: ["scripts/doc-parity.mjs"], // docs-versus-code checks, see lib/parity.mjs
};
