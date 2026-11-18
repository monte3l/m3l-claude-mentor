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

| Situation                                      | Resolution                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Self-report high, probe fails                  | Level from evidence; calibration down; targeted Explain + demo                       |
| Self-report high, observed usage confirms      | Raise to `Applied`; calibration up                                                   |
| Quiz pass, observed misuse                     | Observed wins on Apply; flag "knows but does not apply"; targeted Explain + demo     |
| Observed correct usage, explain-back fails     | Apply stands; Understand stays low; flag "works by rote"; Socratic lesson on the why |
| Explain-back strong, quiz fails on a term      | Keep Understand; Recall low; Reference plus spaced Recall quiz                       |
| Old evidence contradicts newer evidence        | Newer wins; decay old                                                                |
| Product change (changelog) invalidates a topic | Reset affected dimensions to `Introduced`; digest and re-teach                       |

## 5. Plugin architecture

```
m3l-claude-mentor/
  .claude-plugin/plugin.json         # manifest (only `name` required); userConfig: dial, transcriptAnalysis
  output-styles/mentor.md            # voice and tip prefix; opt-in (no force-for-plugin)
  skills/                            # namespaced /m3l-claude-mentor:<verb>
    teach/                           # on-demand lesson (style picker)
    ask/                             # reference lookup, live docs
    quiz/                            # Recall quiz and spaced review
    whats-new/                       # changelog digest since last session
    profile/                         # view/edit goals, catalog, mutes, export/import, purge
    assess/                          # verification probes, explain-back judging
  agents/
    mastery-assessor.md              # read-only (Read, Grep, Glob): judges probe answers, returns JSON verdicts
    docs-researcher.md               # WebFetch only: fetches official docs and changelog; isolated context
  hooks/hooks.json                   # command hooks running src/hooks/*.ts
  src/                               # TypeScript: the hooks and the CLI run from here directly, nothing is built
  data/topic-catalog.json            # default topics, types, dependencies
  evals/                             # `claude plugin eval` cases and graders
```

Hook events (command hooks only):

| Event                                   | Job                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `SessionStart` (startup, resume, clear) | Load profile summary, due reviews, digest flag via `additionalContext`          |
| `SessionStart` (compact)                | Re-inject learner state after compaction                                        |
| `UserPromptSubmit`                      | Detect signals; run the segment gate; inject style hint and tip directive       |
| `PostToolUse`                           | Extract feature-usage signals; append observed-usage evidence                   |
| `Stop`                                  | Record activity only (no segment boundary); never returns context or a decision |
| `PostCompact`                           | Update segment state only (it cannot inject context)                            |

Notes:

- Hooks are the deterministic part (rate limiting, state loading, usage observation). The output style and skills carry the soft behavior.
- `PostToolUse` only appends observed evidence. `SessionStart` then recomputes levels from that evidence, **raise-only**: it never lowers a stored level (decay and truncation of the evidence window could otherwise erase a quiz-earned level), and the explicit `recompute` command is the only path that lowers one. This keeps tips from firing on topics the learner already uses.
- `Stop` `additionalContext` forces the conversation to continue, and `PreCompact`/`PostCompact` output cannot reach the model, so tips are injected on `UserPromptSubmit` and context is restored with `SessionStart` matcher `compact`.
- Skills are namespaced by plugin: `/m3l-claude-mentor:teach`, not `/mentor teach`. State access from skills goes through a small CLI (`src/cli/mentor-state.ts`), so Markdown never hand-edits JSON.
- Plugin agents ignore `hooks`, `mcpServers` and `permissionMode` frontmatter; hooks ship at plugin level.
- The CLI commands are `show`, `get-profile`, `record-evidence`, `record-batch`, `recompute`, `introduce`, `record-pass`, `set-mute`, `set-topic-mute`, `exclude-project`, `get-goals`, `set-goals`, `topics`, `set-topic-override`, `set-changelog-version`, `export`, `import` and `purge`. A leading `--data-dir <absolute path>` beats the environment. `record-batch` takes 1 to 10 events, validates before the first write and saves once, so a lesson or quiz needs one save per answered group.
- Every write to the state files takes one lock on the data directory, `.state.lock` (`src/internal/lock.ts`), created exclusively with a random token. A lock older than 5 s, judged by its modification time alone, is broken by exactly one waiter, and release removes the lock only if it is still ours. Hooks wait at most 2 s, well under their 10 s limit, and the CLI waits 6 s, longer than the stale window, so it always eventually succeeds. A lock that stays held ends in `LOCK_TIMEOUT` with fixed text, and an unwritable data directory fails at once with `WRITE_FAILED` instead of waiting. The store functions never lock; the callers do, around a whole load-compute-save. `import` stages all five files before taking the lock and holds it only for the renames, `purge` locks only an existing directory, and `export` and the read-only commands take no lock.
- On a lock timeout `Stop`, `PostCompact` and `PostToolUse` skip the write with the usual single stderr line and exit 0. `SessionStart` computes the refreshed profile without the lock, takes it only when a level would be raised, and on a timeout injects its context from the stored profile. `UserPromptSubmit` fails closed: no tip, no mute or resume notice (nothing was saved), and nothing at all for a learner who has muted tips, though a learner who has not still gets the style hint and teach offer. A hook that degrades this way reports it through the optional `note` of its output, one stderr line that never reaches the JSON.
- A skill's `allowed-tools` pre-approval lasts only for the turn the learner invokes it, and a plugin cannot ship permission rules. The README therefore documents a one-time user rule for the CLI and a narrower, still unverified, rule set. The `docs-researcher` agent prompts per domain for `WebFetch`, which the README also covers.
- Skills dispatch the agents by the scoped name `m3l-claude-mentor:<agent>`, with a self-contained prompt because a subagent sees no conversation. The `assess` skill rebuilds the `record-batch` tokens itself from the verdicts and never takes a token string from the agent. Both dispatches were confirmed live by the evals.
- Hook event names and payload fields must be re-verified against current docs at build time.

## 6. Ambient engine

- **Segment** = a stretch of work between natural breaks: a topic change or an idle gap (30 minutes with no learner activity). Limit: **1 tip per segment**. Claude Code gives no reliable "task complete" signal and `Stop` fires after every turn, so task completion is not detected; `Stop` only records activity, so a long agent turn is not mistaken for idleness.
- A tip is only emitted if: it relates to the current task, the topic is below target mastery, the learner's dial permits, and the session is not in a "busy" state.
- **Delivery (hybrid):** a command hook makes the deterministic decision (rate limit, dial, busy state, topic). The `UserPromptSubmit` hook then injects `additionalContext` asking the model to add one prefixed tip line after its answer. Compliance is soft; evals measure it.
- Format: one or two lines, prefixed distinctly so it can be ignored or silenced; never blocks or alters the task result.
- Controls: `userConfig` `dial` (0-5, default 2) and `transcriptAnalysis` (on/off), editable in `/config`; mute and per-topic mutes live in `state.json` and change through `/m3l-claude-mentor:profile` or conversation. Dial 0 means silent.
- Mastered topics are silent unless a spaced Recall quiz is due.

## 7. On-demand lessons and reference

- `/m3l-claude-mentor:teach <topic>`: picks the style via section 3, runs a multi-turn lesson, updates the map.
- `/m3l-claude-mentor:ask <question>`: Reference style, answer sourced from live docs with a link.
- `/m3l-claude-mentor:quiz`: spaced Recall quiz from due items.
- `/m3l-claude-mentor:whats-new`: changelog digest filtered to the learner's goals and mastery map.
- `/m3l-claude-mentor:assess <topic>`: a verification probe for a claimed level, judged by the `mastery-assessor` agent. Applied and Fluent can only be refuted by a probe, never confirmed.
- `/m3l-claude-mentor:profile`: goals, catalog, mutes, export/import, show-and-delete.

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

## 10. State and privacy

User-level storage in `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`). It survives plugin updates but is deleted when the plugin is uninstalled, unless `--keep-data` is passed, so export/import ships early. Contents:

| File                       | Content                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `profile.json`             | Per-topic levels, per-dimension evidence, calibration score    |
| `evidence.jsonl`           | Append-only log: channel, topic, result, timestamp, session id |
| `goals.md`, `catalog.json` | Customization (section 8)                                      |
| `state.json`               | Dial, mute, segment counters, last-seen changelog version      |

Transcript reading (chosen by the user) is a sensitive capability. Proposed safeguards, which the user has not yet confirmed:

- Local only; nothing is sent anywhere except normal model calls.
- Extract **feature-usage signals** (for example "created a skill with valid frontmatter") and store those, not conversation content.
- Skip or redact secrets-bearing content; honor an exclusion list of projects.
- A visible switch to turn transcript analysis off, and a command to show and delete everything stored.

## 11. Evaluation

- Plugin evals via `claude plugin eval` (Claude Code 2.1.269 or later). Cases live in `evals/<group>/<case>/case.yaml` with inline graders. By default each case also runs without the plugin, but the skill and agent graders are `with-only` indicators, so those cases score only with `--ablation none`.
- Covered now (7 cases, all 3 of 3 on the last live run, 2026-11-18 against Claude Code 2.1.327, $2.83 in total): skill triggers for natural phrasing (quiz, teach, assess, whats-new), a verification probe on an over-claim (an `llm` grader), and agent dispatch by `ask` and `assess`.
- Not an eval, by platform limit: the tip rate limit and mastered-topic silence. As of Claude Code 2.1.327 a case is one live prompt in an empty workspace with a fresh configuration, cannot pre-seed `CLAUDE_PLUGIN_DATA`, cannot set `userConfig` values (only `EVAL_*` environment variables), and no grader can read the data directory. These behaviours are covered by tests that run the real hooks as processes with a seeded data directory, the plugin options in the environment and parallel prompts; `evals/README.md` lists them. An eval stays the right tool for what the hooks cannot decide: how the model words a tip and which skill it picks.
- Deferred: CI wiring, which needs a pinned `--model` and `--judge-model` and a credential. Evals call a real model, so they run locally under `--max-cost-usd`.
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

Defaults chosen by the designer (not asked; change freely): 5. **Name, license, publishing:** the name is `m3l-claude-mentor`, the license is MIT, and the plugin is published through the `monte3l/m3l-plugins` catalog (not npm). 6. **`mastery-assessor` memory:** none. It reads only files the learner names, and the calling skill passes it the data it needs, so all learner state stays in the state files. 7. **Output style:** opt-in, not forced for the plugin. Hooks and skills carry ambient behavior regardless, and the style is recommended during setup.

## 14. Decisions from the design audit (2026-11-05)

Confirmed by the user after checking this spec against current official docs:

8. **Commands:** separate skills, namespaced `/m3l-claude-mentor:<verb>`.
9. **Tips:** hybrid delivery (hook decides, model words the tip on `UserPromptSubmit`).
10. **Hook build:** none. The hooks and the CLI run `src/*.ts` directly, because Node removes the types itself. This replaces the earlier decision to commit a built `dist/` (2026-11-18): a generated executable artifact in version control fails OpenSSF Baseline OSPS-QA-05.01, and a verify step (`no-dist`) now fails if build output is ever committed again.
11. **Controls:** `userConfig` for `dial` and `transcriptAnalysis`; `state.json` for mutes.
12. **Recompute:** the SessionStart recompute is raise-only; only the explicit `recompute` command lowers a level.
13. **Segments:** a segment ends on a topic change or a 30-minute idle gap. `Stop` and `PostCompact` only record activity.
14. **Topic matching:** no generic single-word keywords, slash keywords match only at a word start, and model keywords are Claude-specific.
15. **Confirming a level:** three good events are needed in practice (see section 4.3).

## 14a. Decisions for the 1.0.0 hardening (2026-11-18)

Confirmed by the owner:

16. **Plugin name:** it stays `m3l-claude-mentor`. `claude plugin validate` warns that the name reads as Anthropic's own because "claude" is a whole word in it. The warning is accepted: the name is part of the contract (every skill is invoked as `/m3l-claude-mentor:<name>`), the data directory, the catalog entry and the docs URL, so a rename is a migration, not a polish.
17. **Stale locks recover by age only:** a lock older than 5 s is broken. There is no process-liveness check, because it can wrongly break a live lock when containers or WSL share a volume with different process namespaces. A crashed holder costs at most a few seconds of skipped hook writes.
18. **`UserPromptSubmit` fails closed on a lock timeout:** no tip, because a tip that cannot be recorded could be followed by a second in the same segment.
19. **`export` stays lock-free** (it works from a read-only data directory, and may mix generations when it races a writer), and **the evidence log stays unbounded** with the cost written down in section 15.
20. **Hook output may carry a note:** an optional field that becomes one stderr line, so a hook that degrades keeps its normal output.
21. **The 1.0.0 contract freeze:** from 1.0.0 the six skill names, the `dial` and `transcriptAnalysis` options, export format version 1 (every 1.x release imports it) and the guarantees in the ROADMAP's "What this project will not do" list change only in a major release. The hook internals, the `mentor-state` CLI and its path, the evals, the topic catalogue and the data directory layout beyond the export format are outside it, because the skills ship in the same plugin version as the CLI they call. A contract test and a committed version 1 export pin it, and adding a skill or an option is a minor release and does not fail them.

## 15. Open questions

None blocking. Still open:

- Not yet verified live: the narrower permission rules in the README, `PostToolUse` recording in a tool-using session, dial 0 in a live session, and that the hooks fire on the minimum Claude Code version the plugin supports.
- CI wiring for the evals (section 11). The tip rate limit and mastered-topic silence cannot be evals today, because the eval case format cannot seed the plugin data directory, set `userConfig` or run two live prompts; they are covered by tests that run the hooks as real processes. An upstream request for those three capabilities is optional and not filed.
- Known limits, accepted for 1.0:
  - The state lock is best effort at its edges: a holder that runs past the 5 s stale window loses exclusion, and two processes breaking the same stale lock can briefly overlap. Both fall back to last-writer-wins. Network filesystems with large clock skew are approximate.
  - A hook that cannot get the lock within 2 s skips its write (see section 5).
  - `export` can mix generations when it races a writer.
  - `evidence.jsonl` grows without bound, about 5 MiB a year of heavy use, and only the last 2 MiB is read.
  - Project exclusion follows symlinks and folds case on macOS and Windows. It stays case-sensitive on Linux mounts that are case-insensitive and does not fold Unicode normalisation forms. Resolving a path on a hung network mount can block until the hook times out, which fails safe.
  - A broken install or an unwritable data directory makes a hook print one stderr line per event. Claude Code shows that only in verbose output, so the learner sees nothing. A `doctor` command could surface it and is not planned.
  - `UserPromptSubmit` can say "Mentor tips muted for X" when the 500-topic cap stopped the mute from being saved. It predates the lock and is not fixed yet.
