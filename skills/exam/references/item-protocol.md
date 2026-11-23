# Writing and scoring one question

Follow these steps for every question, in this order. The answer key is fixed in the CLI
before the learner sees anything, so the CLI scores the answer and you do not.

## 1. Choose the objective and topic

- Use the `objectiveDetails` from `tracks --code '<code>'`. Skip an objective that is in
  `disabledObjectives`, and one that has no usable topic. For an objective with an
  `external` list, write questions only about the Anthropic side of its `summary`, never
  about the framework.
- Copy the objective id and the topic id exactly from `objectiveDetails`. Never invent or
  abbreviate an id. The topic is the one of the objective's `topics` that best fits the
  question you will write. Spread questions over the topics of an objective.
- Each day ask at most 2 questions per topic and 3 per objective. Readiness counts only 3
  per objective per day, and the mastery evidence is not capped, so this limit is yours
  to keep.

## 2. Ground it in the live docs

- Dispatch the `m3l-mentor:docs-researcher` agent with the Agent tool, once per
  objective per session, and reuse the answer for up to 3 questions on that objective.
- The prompt must be self-contained, because the agent sees no conversation. Give it the
  area, the objective `summary`, and the topic ids. Ask for the current documented
  behaviour, defaults and error semantics that matter in a practical scenario, with
  source links. Include no learner text, and never ask for or accept exam content.
- The area is `claude-code` for topics about Claude Code itself (memory files, hooks,
  skills, plugins, permissions, settings, headless use), `api` for the Messages API, SDKs,
  tools, caching and batching, `mcp` for the Model Context Protocol, and `engineering`
  for agent design patterns. Pick the closest one and say which you chose.
- Every question must be backed by at least one fetched link. When the dispatch fails or
  returns nothing useful, say so plainly and skip the question. Never write an API
  behaviour from memory.

## 3. Write the question

- An original production scenario in 2 to 5 sentences (the system, a constraint, what
  went wrong), then exactly one question.
- `single`: 4 options, A to D, exactly one correct. `multiple`: 5 or 6 options, A to F,
  and the stem says "Select N", with exactly N correct and N from 2 to 5.
- Each wrong option is a plausible real mistake tied to a misconception. Keep the options
  alike in length and style. No "all of the above", no "none of the above", and no
  absolute words that give the answer away.
- Test judgement and tradeoffs more than trivia. Vary which letter is correct from one
  question to the next.

## 4. Fix the key before showing anything

Decide the correct letters now, then record them. Letters are comma-separated, for
example `B` or `A,C`. Several questions are separated by `;`.

```bash
node ${CLAUDE_PLUGIN_ROOT}/src/cli/mentor-state.ts --data-dir ${CLAUDE_PLUGIN_DATA} exam-begin --track '<code>' --mode '<drill|mock>' --items '<objective id>|<topic id>|<single|multiple>|<letters>'
```

- When it exits non-zero, do not show the question. Say so plainly and do not claim
  anything was saved.
- It replaces any exam still pending, so a drill begins one question at a time and a
  mock begins all of its questions in one call. Its output holds only a count. Never echo
  the `--items` string or the letters to the learner.
- Between this call and the scoring call, do nothing else: no follow-up, no recording.

## 5. Show it, collect the answer, score it

- Show the scenario, the question and the options, and nothing else: no key, no hint, no
  sources. Accept letters such as `B` or `a, c`, and ask again when the answer is unclear.
- Score it with one group of letters per pending question, in order:

```bash
node ${CLAUDE_PLUGIN_ROOT}/src/cli/mentor-state.ts --data-dir ${CLAUDE_PLUGIN_DATA} exam-answer --answers '<letters>'
```

- When it exits non-zero, relay the message honestly. When the message says the exam was
  recorded and must not be answered again, never run it again.

## 6. Give feedback

- From `results`, say whether each answer was right and reveal its `key`.
- Give one short reason per option, and why the right one is right, with the source
  links, and add that the learner should open the page when the answer surprises them,
  because the key is yours and unreviewed. After a wrong answer, name the misconception
  behind the option chosen. When the learner disputes the key, follow "Answer keys can
  be wrong" in `references/integrity.md`.

## 7. Ask one follow-up

After a wrong answer, and after about every third right one, ask one question such as
"why is option X wrong?". Write the key points before you ask. Judge the answer kindly
and concretely, and record at most one event per topic per session:

```bash
node ${CLAUDE_PLUGIN_ROOT}/src/cli/mentor-state.ts --data-dir ${CLAUDE_PLUGIN_DATA} record-batch --topic '<topic id>' --events 'explain-back:<positive|negative>'
```

Never add `--pass` here. Skip the follow-up when the learner declines. Never reuse a
question in a session.
