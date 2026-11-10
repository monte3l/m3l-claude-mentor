# Claude Code Mentor Harness: Design Spec

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

These values decide when the mentor stays quiet on a topic and when it quizzes again, so they shape the whole mentor. The functions take them as options today; wiring them to catalog overrides (section 13, item 3) is not done yet.

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
    mastery-assessor.md              # read-only: scores evidence, proposes level changes
    docs-researcher.md               # fetches official docs and changelog; isolated context
  hooks/hooks.json                   # command hooks running dist/hooks/*.js
  dist/                              # committed build output (hooks and CLI run from here)
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
- Skills are namespaced by plugin: `/m3l-claude-mentor:teach`, not `/mentor teach`. State access from skills goes through a small CLI (`dist/cli/mentor-state.js`), so Markdown never hand-edits JSON.
- Plugin agents ignore `hooks`, `mcpServers` and `permissionMode` frontmatter; hooks ship at plugin level.
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

- Plugin evals via `claude plugin eval` (cases in `evals/<case>/prompt.md` with graders; `history_file` replays multi-turn context) to check that behaviors fire (rate limit respected, probe issued on over-claim, mastered topics silent). By default each case also runs without the plugin, which gives the with/without comparison.
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

Defaults chosen by the designer (not asked; change freely): 5. **Name, license, publishing:** name TBD at project start; license follows the owner's stated stance (open source acceptable with authors and org credited); publishing deferred until the harness has been used privately. 6. **`mastery-assessor` memory:** none. It reads only the state files, so all learner state stays in one inspectable place. 7. **Output style:** opt-in, not forced for the plugin. Hooks and skills carry ambient behavior regardless, and the style is recommended during setup.

## 14. Decisions from the design audit (2026-11-05)

Confirmed by the user after checking this spec against current official docs:

8. **Commands:** separate skills, namespaced `/m3l-claude-mentor:<verb>`.
9. **Tips:** hybrid delivery (hook decides, model words the tip on `UserPromptSubmit`).
10. **Hook build:** commit built `dist/`; a verify step fails when it is stale.
11. **Controls:** `userConfig` for `dial` and `transcriptAnalysis`; `state.json` for mutes.

## 15. Open questions

None blocking. Items 5-7 above are unconfirmed defaults. Open item: scoring constants (weights, half-life, negative multiplier, threshold) are function options but are not yet read from catalog overrides, which section 13 item 3 calls for.
