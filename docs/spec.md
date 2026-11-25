# Claude Code Mentor Harness: Specification

Status: draft from interview rounds 1-4. Deliverable is this file, to be dropped into the new repository. Nothing here is built yet.

## 1. Purpose

A Claude Code plugin that mentors one learner on Claude and Claude Code: theory, terminology, features, best practices and tips. What it teaches, how, and how often are customizable.

Evidence base (official sources, via research pass):

- Anthropic's coding-skills study (52 engineers): full delegation and AI-led debugging scored lowest; asking for explanations or conceptual questions scored higher. Learning-mode efficacy in agentic Claude Code is **unproven**, so this harness measures its own effect (section 11).
- Built-in output styles (Proactive, Concise, Explanatory, Learning) are the closest precedent; `Learning` is the nearest match to a mentor. Output styles are instructions, not guarantees.
- Study: "How AI Impacts Skill Formation" (Shen and Tamkin, January 2026, 52 engineers). Sources: anthropic.com/research/AI-assistance-coding-skills and arxiv.org/pdf/2601.20245.

## 2. Decisions from the interview

| Area            | Decision                                                            |
| --------------- | ------------------------------------------------------------------- |
| Learner level   | Mixed and adaptive, assessed per topic                              |
| Packaging       | Installable plugin (user scope)                                     |
| Styles          | Socratic, Explain + demo, Recall quiz (no exercises), Reference     |
| Channels        | Ambient (always on) plus on-demand (references, lessons)            |
| Style selection | By mastery level, in-session signals and task context               |
| Ambient dose    | Rate-limited: at most 1 tip per session segment                     |
| Customization   | Goals file plus topic catalog, editable directly or by conversation |
| Freshness       | Live docs lookup plus changelog digest                              |
| State           | User-level files; mentor may read session transcripts               |
| Deliverable     | Markdown spec, not shared                                           |

## 3. Teaching styles

| Style          | Behavior                                                          |
| -------------- | ----------------------------------------------------------------- |
| Socratic       | Ask a question first; explain after the learner reasons           |
| Explain + demo | Short explanation, then a live example in the learner's workspace |
| Recall quiz    | One or two short questions on previously seen material; no tasks  |
| Reference      | Concise answer plus doc link; no follow-up                        |

### Selection matrix (defaults, overridable)

| Topic type              | Ambient                             | On-demand                            |
| ----------------------- | ----------------------------------- | ------------------------------------ |
| Concepts and theory     | Explain + demo                      | Socratic, then Explain + demo        |
| Terminology             | Reference (one-line gloss)          | Reference, then Recall quiz          |
| Features and how-to     | Explain + demo tied to current task | Explain + demo; Socratic if familiar |
| Best practices and tips | One-line tip                        | Socratic                             |
| Fast-moving facts       | Digest line                         | Reference, fetched live              |
| Mastered topics         | Silent or spaced Recall quiz        | Reference only                       |

Modifiers, in order of application:

1. **Mastery level**: unfamiliar leans Explain + demo; familiar leans Socratic or Reference.
2. **In-session signals**: "just tell me" or repeated follow-ups shift toward Reference or Explain; confident correct answers shift toward Socratic.
3. **Task context**: busy or mid-task sessions force the lightest style (one-line tip or silence).

## 4. Mastery model

### 4.1 Competency dimensions and evidence channels (no overlap)

Each channel proves exactly one thing, by a different mechanism.

| Channel        | Proves                              | Produced by                        | Mechanism                                |
| -------------- | ----------------------------------- | ---------------------------------- | ---------------------------------------- |
| Observed usage | **Apply**: can do it in real work   | Transcript and tool-event analysis | Passive, unprompted                      |
| Explain-back   | **Understand**: grasps the why      | Learner, in own words              | Mentor-prompted, judged against a rubric |
| Recall quiz    | **Recall**: retains facts and terms | Mentor-initiated, spaced           | Short retrieval questions, auto-graded   |
| Self-report    | **Belief**: the learner's own claim | Learner statement                  | A claim only; never proof                |

Required dimensions by topic type:

| Topic type          | Required for "mastered"        |
| ------------------- | ------------------------------ |
| Terminology         | Recall                         |
| Concepts            | Understand, plus Recall        |
| Features and how-to | Apply, plus Understand         |
| Best practices      | Apply, plus Understand ("why") |

### 4.2 Levels (per topic)

`Unseen` → `Introduced` → `Claimed` (unverified) → `Recalled` → `Understood` → `Applied` → `Fluent` (all required dimensions satisfied, sustained across 3+ sessions with spaced confirmation).

### 4.3 Precedence and weights

Base evidence weights: Observed usage 0.40, Explain-back 0.30, Recall quiz 0.20, Self-report 0.10 (capped: it can set the `Claimed` level and a prior, never more).

Rules:

- Weights are applied with recency decay and a confidence factor (one lucky quiz answer counts less than three over time).
- **Precedence on conflict, same dimension:** Observed usage > Explain-back > Recall quiz > Self-report.
- **Cross-dimension disagreement is not a conflict.** It is a diagnosis (a gap), and is handled with a targeted lesson (4.5).
- Negative evidence is weighted at least as heavily as positive evidence from the same channel.

**What the weights do, and the defaults chosen at implementation.** Levels are decided per dimension, as section 4.1 says: each channel scores its own dimension, and a dimension counts as shown when its score reaches 0.5. The 0.40/0.30/0.20/0.10 weights do not set a level. They only combine the four channel scores into one overall topic score, used to rank which topic to teach or review next, and they cap what self-report can contribute to that score. The interviews did not specify the following numbers; they were chosen when the scoring was built and are the shipped defaults, safe to change while no learner profile holds real data:

| Parameter                    | Default | Effect                                                                                                                                                                                                                       |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Negative evidence multiplier | 1.5     | A wrong answer counts 1.5 times as much as a right one in the same channel                                                                                                                                                   |
| Recency half-life            | 30 days | Evidence loses half its weight every 30 days, and old events also count less toward confidence                                                                                                                               |
| Dimension satisfied at score | 0.5     | One good answer scores 1/3 and two score exactly 0.5 only before any recency decay; two answers recorded seconds before a recompute fall just under, so three good answers are needed in practice (the skills ask for three) |

These values decide when the mentor stays quiet on a topic and when it quizzes again, so they shape the whole mentor. They are function options, and the CLI `recompute` and `record-batch` commands and the SessionStart recompute read them from the catalog overrides (section 13, item 3).

### 4.4 Self-report handling (challenge, never trust blindly)

1. Record the claim as `Claimed` and note the confidence the learner states.
2. Run a **verification probe** before raising any level: an Explain-back prompt or a Recall question matched to the topic type. In ambient mode, wait for a natural moment.
3. Probe result and any observed usage override the claim. A failed probe sets the level from evidence, not from the claim.
4. Track a per-learner **calibration score** (claims confirmed vs. refuted). Over-claimers get more probing and a lower prior; accurate claimers get lighter probes.
5. Under-claiming (evidence exceeds the claim): trust the evidence, tell the learner, and ask to confirm.

### 4.5 Conflict reconciliation table

| Situation                                      | Resolution                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Self-report high, probe fails                  | Level from evidence; calibration down; targeted Explain + demo                                          |
| Self-report high, observed usage confirms      | Raise to `Applied`; calibration up                                                                      |
| Quiz pass, observed misuse                     | Observed wins on Apply; flag "knows but does not apply"; targeted Explain + demo                        |
| Observed correct usage, explain-back fails     | Apply stands; Understand stays low; flag "works by rote"; Socratic lesson on the why                    |
| Explain-back strong, quiz fails on a term      | Keep Understand; Recall low; Reference plus spaced Recall quiz                                          |
| Old evidence contradicts newer evidence        | Newer wins; decay old                                                                                   |
| Product change (changelog) invalidates a topic | Reset the topic to `Introduced` after the learner agrees (`reset-topic`, undoable); digest and re-teach |

## 5. Plugin architecture

```
m3l-mentor/
  .claude-plugin/plugin.json         # manifest (only `name` required); userConfig: dial, transcriptAnalysis
  output-styles/mentor.md            # voice and tip prefix; opt-in (no force-for-plugin)
  skills/                            # namespaced /m3l-mentor:<verb>
    teach/                           # on-demand lesson (style picker)
    ask/                             # reference lookup, live docs
    quiz/                            # Recall quiz and spaced review
    whats-new/                       # changelog digest since last session
    profile/                         # view/edit goals, catalog, mutes, export/import, purge
    assess/                          # verification probes, explain-back judging
    exam/                            # certification practice questions, readiness, study plan
  agents/
    mastery-assessor.md              # read-only (Read, Grep, Glob): judges probe answers, returns JSON verdicts
    docs-researcher.md               # WebFetch only: fetches official Claude, API, MCP docs and the changelog; isolated context
  hooks/hooks.json                   # command hooks running src/hooks/*.ts
  src/                               # TypeScript: the hooks and the CLI run from here directly, nothing is built
  data/topic-catalog.json            # default topics, types, dependencies
  evals/                             # `claude plugin eval` cases and graders
```

Hook events (command hooks only):

| Event                                   | Job                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `SessionStart` (startup, resume, clear) | Load profile summary, due reviews, active exam track, digest flag via `additionalContext` |
| `SessionStart` (compact)                | Re-inject learner state after compaction                                                  |
| `UserPromptSubmit`                      | Detect signals; run the segment gate; inject style hint and tip directive                 |
| `PostToolUse`                           | Extract feature-usage signals; append observed-usage evidence                             |
| `Stop`                                  | Record activity only (no segment boundary); never returns context or a decision           |
| `PostCompact`                           | Update segment state only (it cannot inject context)                                      |

Notes:

- Hooks are the deterministic part (rate limiting, state loading, usage observation). The output style and skills carry the soft behavior.
- `PostToolUse` only appends observed evidence. `SessionStart` then recomputes levels from that evidence, **raise-only**: it never lowers a stored level (decay and truncation of the evidence window could otherwise erase a quiz-earned level), and the explicit `recompute` command and the learner-confirmed `reset-topic` are the only paths that lower one. This keeps tips from firing on topics the learner already uses.
- `Stop` `additionalContext` forces the conversation to continue, and `PreCompact`/`PostCompact` output cannot reach the model, so tips are injected on `UserPromptSubmit` and context is restored with `SessionStart` matcher `compact`.
- Skills are namespaced by plugin: `/m3l-mentor:teach`, not `/mentor teach`. State access from skills goes through a small CLI (`src/cli/mentor-state.ts`), so Markdown never hand-edits JSON.
- Plugin agents ignore `hooks`, `mcpServers` and `permissionMode` frontmatter; hooks ship at plugin level.
- The CLI commands are `show`, `get-profile`, `record-evidence`, `record-batch`, `recompute`, `introduce`, `record-pass`, `set-mute`, `set-topic-mute`, `exclude-project`, `get-goals`, `set-goals`, `topics`, `set-topic-override`, `set-changelog-version`, `reset-topic`, `export`, `import` and `purge`, plus the exam commands of section 16 (`tracks`, `set-track`, `exam-begin`, `exam-answer`, `readiness`, `exam-items`, `exam-void` and `exam-unvoid`). A leading `--data-dir <absolute path>` beats the environment. `record-batch` takes 1 to 10 events, validates before the first write and saves once, so a lesson or quiz needs one save per answered group.
- Every write to the state files takes one lock on the data directory, `.state.lock` (`src/internal/lock.ts`), created exclusively with a random token. A lock older than 5 s, judged by its modification time alone, is broken by exactly one waiter, and release removes the lock only if it is still ours. Hooks wait at most 2 s, well under their 10 s limit, and the CLI waits 6 s, longer than the stale window, so it always eventually succeeds. A lock that stays held ends in `LOCK_TIMEOUT` with fixed text, and an unwritable data directory fails at once with `WRITE_FAILED` instead of waiting. The store functions never lock; the callers do, around a whole load-compute-save. `import` stages every file it replaces before taking the lock and holds it only for the renames, `purge` locks only an existing directory, and `export` and the read-only commands take no lock.
- On a lock timeout `Stop`, `PostCompact` and `PostToolUse` skip the write with the usual single stderr line and exit 0. `SessionStart` computes the refreshed profile without the lock, takes it only when a level would be raised, and on a timeout injects its context from the stored profile. `UserPromptSubmit` fails closed: no tip, no mute or resume notice (nothing was saved), and nothing at all for a learner who has muted tips, though a learner who has not still gets the style hint and teach offer. A hook that degrades this way reports it through the optional `note` of its output, one stderr line that never reaches the JSON.
- A skill's `allowed-tools` pre-approval lasts only for the turn the learner invokes it, and a plugin cannot ship permission rules. The README therefore documents a one-time user rule for the CLI and a narrower rule set, checked live on Claude Code 2.1.327. The `docs-researcher` agent prompts per domain for `WebFetch`, which the README also covers.
- Skills dispatch the agents by the scoped name `m3l-mentor:<agent>`, with a self-contained prompt because a subagent sees no conversation. The `assess` skill rebuilds the `record-batch` tokens itself from the verdicts and never takes a token string from the agent. Both dispatches were confirmed live by the evals.
- Hook event names and payload fields must be re-verified against current docs at build time.
- **Minimum Claude Code version: 2.1.207** (Claude Code CHANGELOG, read 2026-11-25). `PostCompact` arrived in 2.1.76, `${CLAUDE_PLUGIN_DATA}` in 2.1.78, plugin options (`userConfig`) in 2.1.83 and the hook exec form (`command` plus `args`, used by every hook) in 2.1.139. The hooks read `dial` and `transcriptAnalysis` from `CLAUDE_PLUGIN_OPTION_*`, whose introduction the changelog does not date; 2.1.207 is the first entry that documents it, so that sets the floor. Releases 2.1.139 to 2.1.206 may work but are not claimed. The `fork` SessionStart source (2.1.214) does not raise it: earlier versions report `resume`, which the same matcher covers. No skill or agent frontmatter field in use is newer. Only 2.1.327 was run live.

## 6. Ambient engine

- **Segment** = a stretch of work between natural breaks: a topic change or an idle gap (30 minutes with no learner activity). Limit: **1 tip per segment**. Claude Code gives no reliable "task complete" signal and `Stop` fires after every turn, so task completion is not detected; `Stop` only records activity, so a long agent turn is not mistaken for idleness.
- A tip is only emitted if: it relates to the current task, the topic is below target mastery, the learner's dial permits, and the session is not in a "busy" state.
- **Delivery (hybrid):** a command hook makes the deterministic decision (rate limit, dial, busy state, topic). The `UserPromptSubmit` hook then injects `additionalContext` asking the model to add one prefixed tip line after its answer. Compliance is soft; evals measure it.
- Format: one or two lines, prefixed distinctly so it can be ignored or silenced; never blocks or alters the task result.
- Controls: `userConfig` `dial` (0-5, default 2) and `transcriptAnalysis` (on/off), editable in `/config`; mute and per-topic mutes live in `state.json` and change through `/m3l-mentor:profile` or conversation. Dial 0 means silent.
- Mastered topics are silent unless a spaced Recall quiz is due.

## 7. On-demand lessons and reference

- `/m3l-mentor:teach <topic>`: picks the style via section 3, runs a multi-turn lesson, updates the map.
- `/m3l-mentor:ask <question>`: Reference style, answer sourced from live docs with a link.
- `/m3l-mentor:quiz`: spaced Recall quiz from due items.
- `/m3l-mentor:whats-new`: changelog digest filtered to the learner's goals and mastery map.
- `/m3l-mentor:assess <topic>`: a verification probe for a claimed level, judged by the `mastery-assessor` agent. Applied and Fluent can only be refuted by a probe, never confirmed.
- `/m3l-mentor:profile`: goals, catalog, mutes, export/import, show-and-delete.
- `/m3l-mentor:exam <code> [drill|mock|readiness|plan] [domain]`: prepares the learner for one of four Claude certification exams with original, model-written practice questions grounded in live docs, a per-domain readiness view and a study plan. The answer key is fixed in the CLI before a question is shown, and the CLI scores the answer. The questions and keys are not reviewed by a person, so every explanation links its docs page. The readiness view is a coverage and practice indicator, never a score prediction.

## 8. Customization

Two surfaces, kept in sync:

- **Goals file** (`goals.md`): stated goals, time horizon, preferred depth, topics of interest or to avoid.
- **Topic catalog** (`catalog.json`): enable, disable, reorder, add custom topics, set per-topic style overrides and target mastery.
- **Conversational**: "teach me hooks next", "stop tips about models". The mentor updates the files and states what changed.

## 9. Freshness

- Live lookup against the official docs indexes and the Claude Code changelog; a `docs-researcher` subagent keeps the fetching out of the main context.
- The digest compares changelog entries since the last session against the catalog and mastery map.
- Fast-moving facts (model names and IDs, pricing, limits) are never stored as lesson content; always fetched.
- Bundled content is limited to stable concepts and the catalog structure.
- Exam tracks (section 16) carry their guide version, its effective date and a `reviewedAt` date. The `tracks` command reports `effectiveFuture` while the guide is not yet in force and `reviewStale` when `reviewedAt` is older than 120 days, and the `exam` skill warns on either. Re-review a track whenever its guide version changes.

## 10. State and privacy

User-level storage in `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`). It survives plugin updates but is deleted when the plugin is uninstalled, unless `--keep-data` is passed, so export/import ships early. Contents:

| File                       | Content                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile.json`             | Per-topic levels, per-dimension evidence, calibration score                                                                                   |
| `evidence.jsonl`           | Append-only log: channel, topic, result, timestamp, session id                                                                                |
| `goals.md`, `catalog.json` | Customization (section 8)                                                                                                                     |
| `state.json`               | Dial, mute, segment counters, last-seen changelog version, active exam track, voided exam submissions                                         |
| `exam-items.jsonl`         | Append-only exam item log: track, domain, objective, topic, kind, mode, correct, timestamp, session id. Never the question, options or answer |
| `exam-pending.json`        | The answer key of the exam in progress (option letters only). Expires after 24 h and is not exported                                          |

Transcript reading (chosen by the user) is a sensitive capability. Proposed safeguards, which the user has not yet confirmed:

- Local only; nothing is sent anywhere except normal model calls.
- Extract **feature-usage signals** (for example "created a skill with valid frontmatter") and store those, not conversation content.
- Skip or redact secrets-bearing content; honor an exclusion list of projects.
- A visible switch to turn transcript analysis off, and a command to show and delete everything stored.

## 11. Evaluation

- Plugin evals via `claude plugin eval` (Claude Code 2.1.269 or later). Cases live in `evals/<group>/<case>/case.yaml` with inline graders. By default each case also runs without the plugin, but the skill and agent graders are `with-only` indicators, so those cases score only with `--ablation none`.
- Covered now (7 cases, all 3 of 3 on the last live run, 2026-11-18 against Claude Code 2.1.327, $2.83 in total): skill triggers for natural phrasing (quiz, teach, assess, whats-new), a verification probe on an over-claim (an `llm` grader), and agent dispatch by `ask` and `assess`.
- Not an eval, by platform limit: the tip rate limit and mastered-topic silence. As of Claude Code 2.1.327 a case is one live prompt in an empty workspace with a fresh configuration, cannot pre-seed `CLAUDE_PLUGIN_DATA`, cannot set `userConfig` values (only `EVAL_*` environment variables), and no grader can read the data directory. These behaviours are covered by tests that run the real hooks as processes with a seeded data directory, the plugin options in the environment and parallel prompts; `evals/README.md` lists them. An eval stays the right tool for what the hooks cannot decide: how the model words a tip and which skill it picks.
- CI: `.github/workflows/evals.yml` runs the suite weekly and on demand with `--model claude-sonnet-5-5`, `--judge-model claude-haiku-5-5` and `--max-cost-usd 10` and `--threshold 0.8`, using the `ANTHROPIC_API_KEY` secret of the `evals` environment. Results are kept as a run artifact for 14 days. Evals call a real model, so they also run locally under `--max-cost-usd`.
- Verified by hand in a real session (Claude Code 2.1.327, plugin 0.3.0 installed from the `monte3l` catalog, recorded 2026-11-19), all seven checks passing:
  - The plugin installs at 0.3.0, and the hooks fire: a data directory with a valid `state.json` appears after the first prompt.
  - The narrower permission rules in the README: no prompt for the lesson's `introduce` and `record-batch` saves, and a prompt for `export`. This ran with `--permission-mode manual`, because the tester's default mode is `auto`, which does not prompt.
  - `PostToolUse` records an `observed` event with a feature name and no content, and records nothing for a project reached through a symlink to an excluded project. Both used a `Write` of `CLAUDE.md` as the trigger: writes under `.claude/` were denied in print mode, so the `.claude/skills` trigger was not exercised live.
  - Dial 0 emits no tip, and `tipsEmitted` and `lastTipAt` do not change.
  - `ask` dispatches `docs-researcher` with no permission prompt beyond the one-time web-fetch domain approval.
  - Three sessions at once leave `state.json` valid and no `.state.lock` behind.
- Learner-facing metrics: quiz retention over time, calibration score trend, tips dismissed vs. acted on.
- Hypothesis to test: ambient plus Socratic teaching improves retention compared with Reference-only. Anthropic's study did not cover agentic use.

## 12. Risks

| Risk                                                  | Mitigation                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| Ambient tips become noise                             | Rate limit, dial, task-context suppression, dismissal tracking |
| Hook cost and latency                                 | Cheap deterministic checks; model work only on due events      |
| Transcript analysis is invasive                       | Section 10 safeguards; off switch                              |
| Style drifts because output styles are not guarantees | Hooks inject style hints; evals                                |
| Mastery scoring wrong or gameable                     | Multi-channel evidence, precedence, calibration, decay         |
| Product changes outdate lessons                       | Live lookup, changelog-driven resets                           |

## 13. Resolved decisions (final round)

Confirmed by the user:

1. **State:** local plugin data directory, no sync. Provide export/import commands for moving a profile between machines.
2. **Transcript safeguards:** all five from section 10 adopted as written (usage signals only, local only, project exclusion list, off switch, show-and-delete command).
3. **Weights and fluency:** 0.40/0.30/0.20/0.10 and "all required dimensions, 3+ sessions" are the shipped defaults, configurable in the catalog.
4. **Segment:** task-based with a time floor. A segment ends at task completion or topic change, and at least about 15 minutes must have passed since the last tip.

Defaults chosen by the designer (not asked; change freely): 5. **Name, license, publishing:** the name is `m3l-mentor`, the license is MIT, and the plugin is published through the `monte3l/m3l-plugins` catalog (not npm). 6. **`mastery-assessor` memory:** none. It reads only files the learner names, and the calling skill passes it the data it needs, so all learner state stays in the state files. 7. **Output style:** opt-in, not forced for the plugin. Hooks and skills carry ambient behavior regardless, and the style is recommended during setup.

## 14. Decisions from the design audit (2026-11-05)

Confirmed by the user after checking this spec against current official docs:

8. **Commands:** separate skills, namespaced `/m3l-mentor:<verb>`.
9. **Tips:** hybrid delivery (hook decides, model words the tip on `UserPromptSubmit`).
10. **Hook build:** none. The hooks and the CLI run `src/*.ts` directly, because Node removes the types itself. This replaces the earlier decision to commit a built `dist/` (2026-11-18): a generated executable artifact in version control fails OpenSSF Baseline OSPS-QA-05.01, and a verify step (`no-dist`) now fails if build output is ever committed again.
11. **Controls:** `userConfig` for `dial` and `transcriptAnalysis`; `state.json` for mutes.
12. **Recompute:** the SessionStart recompute is raise-only; only the explicit `recompute` command and `reset-topic` lower a level.
13. **Segments:** a segment ends on a topic change or a 30-minute idle gap. `Stop` and `PostCompact` only record activity.
14. **Topic matching:** no generic single-word keywords, slash keywords match only at a word start, and model keywords are Claude-specific.
15. **Confirming a level:** three good events are needed in practice (see section 4.3).

## 14a. Decisions for the 1.0.0 hardening (2026-11-18)

Confirmed by the owner:

16. **Plugin name:** `m3l-mentor`. Until 1.2.0 the plugin was called `m3l-claude-mentor`, and `claude plugin validate` warned that the name reads as Anthropic's own because "claude" is a whole word in it. The warning was accepted while the name was the contract (every skill is invoked as `/m3l-mentor:<name>`, and the data directory, the catalog entry and the docs URL carry it), and the rename removed it, so `--strict` now runs in CI. The rename is a migration: the marketplace lists it under `renames`, the first session copies the learner's data from the old data directory (`src/internal/legacy-data.ts`), and the importer still reads exports tagged `m3l-claude-mentor-export`.
17. **Stale locks recover by age only:** a lock older than 5 s is broken. There is no process-liveness check, because it can wrongly break a live lock when containers or WSL share a volume with different process namespaces. A crashed holder costs at most a few seconds of skipped hook writes.
18. **`UserPromptSubmit` fails closed on a lock timeout:** no tip, because a tip that cannot be recorded could be followed by a second in the same segment.
19. **`export` stays lock-free** (it works from a read-only data directory, and may mix generations when it races a writer), and **the evidence log stays unbounded** with the cost written down in section 15.
20. **Hook output may carry a note:** an optional field that becomes one stderr line, so a hook that degrades keeps its normal output.
21. **The 1.0.0 contract freeze:** from 1.0.0 the six skill names, the `dial` and `transcriptAnalysis` options, export format version 1 (every 1.x release imports it) and the guarantees in the ROADMAP's "What this project will not do" list change only in a major release. The hook internals, the `mentor-state` CLI and its path, the evals, the topic catalogue and the data directory layout beyond the export format are outside it, because the skills ship in the same plugin version as the CLI they call. A contract test and a committed version 1 export pin it, and adding a skill or an option is a minor release and does not fail them.
22. **Changelog reset:** `reset-topic --topic <id>` drops a learned topic to `Introduced` when the learner agrees after a `whats-new` digest. It stores `resetAt` and a `resetFrom` snapshot (level, passes, last pass, introduced) on the topic, and every level derivation then ignores evidence older than `resetAt`. The evidence log is never changed, so `reset-topic --topic <id> --undo` restores the snapshot exactly. Undo returns to the snapshot even if post-reset practice raised the topic further; passes earned after the reset are lost, and levels re-derive from the intact log at the next recompute. It resets the whole topic, not single dimensions, and clears its review history until undone. A profile written by an older plugin version drops `resetAt` and `resetFrom` on its next save, so a downgrade ends the reset.

## 15. Open questions

None blocking. Still open:

- Claude Code versions from 2.1.207 up to 2.1.327 are supported on the strength of the changelog (section 5) and have not been run live.
- The tip rate limit and mastered-topic silence cannot be evals today, because the eval case format cannot seed the plugin data directory, set `userConfig` or run two live prompts; they are covered by tests that run the hooks as real processes. An upstream request for those three capabilities is optional and not filed.
- Known limits, accepted for the 2.x series:
  - The state lock is best effort at its edges: a holder that runs past the 5 s stale window loses exclusion, and two processes breaking the same stale lock can briefly overlap. Both fall back to last-writer-wins. Network filesystems with large clock skew are approximate.
  - A hook that cannot get the lock within 2 s skips its write (see section 5).
  - `export` can mix generations when it races a writer.
  - `evidence.jsonl` grows without bound, about 5 MiB a year of heavy use, and only the last 2 MiB is read.
  - Project exclusion follows symlinks and folds case on macOS and Windows. It stays case-sensitive on Linux mounts that are case-insensitive and does not fold Unicode normalisation forms. Resolving a path on a hung network mount can block until the hook times out, which fails safe.
  - A broken install or an unwritable data directory makes a hook print one stderr line per event. Claude Code shows that only in verbose output, so the learner sees nothing. A `doctor` command could surface it and is not planned.

## 16. Certification preparation

The plugin can prepare a learner for four official Claude certification exams: Claude Certified Developer - Foundations (CCDV-F), Architect - Foundations (CCAR-F), Architect - Professional (CCAR-P) and Developer - Professional (CCDV-P). The Associate level is out of scope; adding it needs one new file under `data/tracks/`.

**Tracks.** Each exam is a bundled, paraphrased blueprint in `data/tracks/<code>.json`: the guide version and effective date, the format (120 minutes, a scaled pass mark of 720 out of 1000), domains with weights that sum to 100, and objectives that each map to one to six catalog topics. A Professional track names the Foundations track it assumes. An objective may list third-party frameworks under `external`; the skill names them and sends the learner elsewhere, and never writes questions on them. Blueprints are paraphrased from the public exam guides, never copied. The exam topics live in the same catalog as the others, but with `ambient: false`: they produce no keyword tips and do not appear in the unprompted session-start lists unless their track is the learner's active track. An explicit request for one always works.

**Items.** The `exam` skill writes original scenario questions (single or multiple response) grounded in live docs through `docs-researcher`, and every explanation links its page. It never uses or paraphrases the sample questions in the exam guides and refuses to discuss real exam items. The model fixes the answer key with `exam-begin` before the question is shown, and `exam-answer` scores it in code (a multiple-response item is right only on the exact set). A drill is one item per begin and answer cycle; a mock is 10 to 15 items begun together and scored together. A follow-up "why is this option wrong?" is judged as an explain-back, and it is the only way the item raises understanding, because quiz evidence feeds only the recall dimension.

**Evidence.** Each scored item appends one quiz evidence event for its topic and one line to the exam item log. The question, options and answer are never stored. The key sits in `exam-pending.json` until it is answered, replaced or 24 hours old.

**Readiness.** A pure function over the profile, the track and the item log (`src/internal/readiness.ts`). Per objective it takes the best level credit among its topics (Unseen 0, Introduced or Claimed 0.1, Recalled 0.5, Understood 0.8, Applied or Fluent 1). Per domain, with at least four effective items, it blends decayed accuracy (21-day half-life) 60% with coverage 40%; with fewer, it uses coverage alone and flags it. At most three items per objective per day count. The index is the weight-weighted sum over domains. It reports no index when it has fewer than 15 effective items, or when the domains with enough items hold under 60% of the weight. It lists the three weakest domains and always says it is **not a score prediction**. All of these numbers are this project's own and have not been validated against real exam results.

**Void.** The answer keys are written by the model and no person reviews them. A learner can dispute a key; when the docs support them, `exam-void` removes that submission (every item answered in one `exam-answer` call) from readiness and topic levels. A void is a `(session, at)` pair in `state.json`, at most 100; the logs are never rewritten, and `exam-unvoid` reverses it.

**Track focus.** `set-track` stores the learner's active exam. While it is set, `SessionStart` adds a one-line hint to run the exam skill and lists that track's topics first, by weight. `teach` and `quiz` offer them first too.

**Limits.** The skill never says a learner will pass. Each track `sourceUrl` points at its Anthropic Partner Academy certification page; all four were checked on 2026-11-25. Only the CCAR-F guide numbers its statements, so only that track carries `officialRef`; the other three guides print unnumbered headings in the same order as our objectives. The quiz-channel mastery evidence from exams is not capped per day, only readiness is.
