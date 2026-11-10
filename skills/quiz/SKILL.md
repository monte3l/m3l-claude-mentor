---
name: quiz
description: Runs a short spaced recall quiz on Claude and Claude Code topics the learner has already seen, judging answers and recording the results. This skill should be used when the user asks to "quiz me", "quiz me on hooks", "test what I know", "test my recall" or "review what I learned", or invokes /m3l-claude-mentor:quiz, optionally with a topic.
argument-hint: "[topic]"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js *)
---

# Quiz

Run a brief recall quiz on the topic in `$ARGUMENTS`, or else on topics due for review.

## Rules for every CLI call

- State access is only through the CLI, one command per line. Never read or edit the
  stored data files directly; never store the questions or answers.
- Wrap every learner-derived value in single quotes; escape an embedded `'` as `'\''`.
  Never use double quotes or backticks. Replace the angle-bracketed part of a
  placeholder with exactly one value.
- If a CLI call exits non-zero, say so plainly and do not claim anything was saved.

## State

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js --data-dir ${CLAUDE_PLUGIN_DATA} get-profile
```

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js --data-dir ${CLAUDE_PLUGIN_DATA} topics
```

`get-profile` lists `reviewDue`, `passes` and `mutedTopics`; `topics` gives titles,
types and `enabled`.

## Steps

1. **Choose topics.** With an argument, match it in `topics`. Otherwise take up to three
   topics whose `reviewDue` is true (that is the only source of due items). When nothing
   is due, say so and offer a quiz on an introduced topic, or
   `/m3l-claude-mentor:teach`.
2. **Skip muted and disabled topics, even when named.** Say why and offer
   `/m3l-claude-mentor:profile`.
3. **Skip fast-moving topics entirely** (`type` is `fast-moving`): say why (their
   facts change too quickly to quiz from memory) and offer `/m3l-claude-mentor:ask`.
   Never answer their questions from memory, and never record anything for them.
4. **Ask three recall questions per topic when possible, one at a time**, on facts, terms
   and the why. Fewer questions cannot raise a level; say so honestly. Wait for each answer. Never reveal an answer before the learner tries; give
   one small hint on "I don't know" and reveal only after a second attempt or request.
5. **Judge and explain** each answer briefly, even when right.
6. **Record each answered group with ONE call**: one `quiz:<result>` event per question
   answered, plus the pass result. Use `pass` when the learner got at least 2 of 3
   right (or the single question, or both when two were asked), else `fail`; a fail
   resets passes. Quote the events list. When the learner stops mid-group (fewer answers
   than questions asked), record nothing for that group, unless they ask to stop and
   score what they answered; never record `--pass fail` for an abandoned group.

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js --data-dir ${CLAUDE_PLUGIN_DATA} record-batch --topic <id> --events '<quiz:positive,quiz:negative,...>' --pass <pass|fail>
```

7. **Report the returned level** honestly: one group or low counts rarely move a level.
8. Repeat from step 4 for the next topic.
9. **Summarise** in two or three lines: what was solid, what to revisit, and the
   returned level. Levels change after repeated evidence, not one quiz; say so honestly
   and never promise a level change. Point weak topics to `/m3l-claude-mentor:teach <id>`.

Quiz recall only; no coding tasks. At most three topics per run.
