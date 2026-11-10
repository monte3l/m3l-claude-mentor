---
name: assess
description: Checks a learner's self-reported skill on a Claude or Claude Code topic with a verification probe, then reports the claim as confirmed, refuted or unverified, kindly and concretely. This skill should be used when the user says "I know X well", "I'm comfortable with X", "I'm advanced at hooks", "skip the basics on skills", or invokes /m3l-claude-mentor:assess.
argument-hint: "[topic]"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js *)
---

# Assess

Verify a claimed skill level without trusting it blindly and without being harsh. The
topic is in `$ARGUMENTS`; when empty, ask which topic and what level is claimed.

## Rules for every CLI call

- State access is only through the CLI, one command per line. Never read or edit the
  stored data files directly; never store the questions or answers.
- Wrap every learner-derived value in single quotes; escape an embedded `'` as `'\''`.
  Never use double quotes or backticks. Replace the angle-bracketed part of a
  placeholder with exactly one value.
- If a CLI call exits non-zero, say so plainly and do not claim anything was saved.

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js --data-dir ${CLAUDE_PLUGIN_DATA} topics
```

Resolve the topic id and `type` from `topics`; ask the learner to pick when ambiguous.

## Steps

1. **Capture the claim.** Ask which level is claimed. Only Recalled, Understood,
   Applied or Fluent are claims to verify; Unseen, Introduced and Claimed are not.
2. **Fast-moving topics** (`type` is `fast-moving`): the result is always `unverified`
   and the level is capped at Introduced. Do not probe; redirect to
   `/m3l-claude-mentor:ask` and stop.
3. **Probe, matched to the claimed rung**, one question at a time, answers hidden until
   the learner tries:
   - Recalled: three recall questions, recorded on the `quiz` channel.
   - Understood: up to three explain-back prompts ("why, in your own words"), recorded
     on `explain-back`; a single prompt cannot confirm.
   - Applied or Fluent: apply evidence only comes from OBSERVED usage, so no probe can
     confirm it. Run an explain-back or recall probe anyway; it can only refute. The best
     outcome is `unverified`. Ask the learner to show real usage in their work.
4. **Judge and record one event per probe answered**, using the matching channel:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js --data-dir ${CLAUDE_PLUGIN_DATA} record-evidence --topic <id> --channel <quiz|explain-back> --result <positive|negative>
```

5. **Record the claim only AFTER the probe was answered.** An abandoned probe records
   nothing.

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js --data-dir ${CLAUDE_PLUGIN_DATA} record-evidence --topic <id> --channel self-report --result positive
```

6. **Recompute** with the claimed level:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli/mentor-state.js --data-dir ${CLAUDE_PLUGIN_DATA} recompute --topic <id> --claim <Level>
```

Confirmation needs three or more positive probe events on the matching channel
(stored earlier events also count). Fewer positives give `unverified`, not
`confirmed`; say more probing or evidence is needed, never imply failure. 7. **Report** the outcome (confirmed, refuted or unverified) from the output, kindly
and concretely. For refuted, name what was solid and the one gap, and offer
`/m3l-claude-mentor:teach <id>`. For unverified, say what would confirm it. 8. **Under-claiming.** When the output carries the `underclaim` diagnosis, the higher
level is already saved; tell the learner and ask them conversationally to confirm.

## Rules

- One event is weak evidence (it scores 1/3), so levels change after repeated evidence.
  Say so honestly; never promise a level change. The CLI decides levels.
- Calibration is tracked silently; never shame a refuted claim.
