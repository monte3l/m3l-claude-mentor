# Modes

Use the steps in `references/item-protocol.md` for every question in `drill` and `mock`.
The limits there apply per day to each topic and objective, and they include earlier
sessions today. When you cannot tell what was asked earlier today, ask the learner.

## drill

About 5 questions in one domain, with feedback after each.

1. The domain is the one in `$ARGUMENTS` when given; when it names no domain of the exam,
   list the domain ids and ask. Otherwise take the first domain of `weakest` from
   `readiness`, and when readiness has no practice yet, the domain with the fewest items
   from `exam-items`. Tell the learner which domain you chose and why, and let them
   override it.
2. Per question, strictly in this order: (a) write it, (b) begin exactly one question,
   (c) show it, (d) get the answer, (e) score it, (f) give feedback, (g) ask the
   follow-up. Never begin the next question before (e) has succeeded, never record a
   follow-up between (b) and (e), and never reveal the key before (e).
3. A question that was begun and not answered is discarded by the next begin and is never
   scored. Say so when the learner wanders off, and begin again when they return.
4. When the domain has too few topics or objectives to stay inside the limits, end the
   drill early and say why, instead of going over them.
5. End with three lines: how many were right, which objectives were practised, and one
   next step. Offer `/m3l-mentor:teach <topic id>` for the weakest topic.

## mock

10 to 15 questions across the exam, with feedback at the end.

1. Ask how many questions, default 10, at most 15 and at least 5. Share them over the
   domains by weight, rounding with the largest remainder. Skip a domain with no usable
   objective and share its questions over the others. Keep the per-topic and
   per-objective limits.
2. Write every question in its final, short form first: 2 to 4 sentences and at most 6
   options. When you cannot finish them all, cut the count (never below 5) before you
   begin the exam, and never after any question has been shown. Then fix every key with
   one begin call that lists the questions separated by `;`. Show them in numbered
   batches of 5, and keep the full text of every shown question in the conversation,
   because the CLI stores none of it.
3. Say that 2 minutes per question is a suggested pace for practice, that the official
   guide states the real timing, and that you cannot time it. Give no feedback until
   every answer is in, and when asked mid-mock reveal no key, no partial score and no
   hint.
4. Collect the answers by question number, such as `1 B, 2 A C`, and turn them into one
   group per question, in order. Ask for every missing or unclear number and never guess
   or fill in a blank. There is no skip letter: ask for a guess, or end the mock without
   scoring. An abandoned mock stays unscored, and nothing is claimed as recorded.
   Score all of them with one call.
5. Report the right answers per domain, then one line of feedback per wrong answer with
   the key and the source link. Ask up to 3 follow-ups, one per topic, and record each.
   This replaces the follow-up cadence of the item protocol. A key disputed after a mock
   was already recorded with the rest, so say that it also affects the readiness view.

## readiness

1. Run:

```bash
node ${CLAUDE_PLUGIN_ROOT}/src/cli/mentor-state.ts --data-dir ${CLAUDE_PLUGIN_DATA} readiness --track '<code>'
```

2. Show one row per domain: its id, `name` and `weight`, `coverage`, `accuracy` (say "no
   questions yet" when it is null), `effectiveItems`, and a note when `lowEvidence` is
   true. Name the domains in `weakest`.
3. When `status` is `insufficient-evidence`, there is no `index`. Say there is not enough
   practice yet to give a figure, and suggest a drill. Never invent a number.
4. When `status` is `ok`, show the `index` as "index N (scale 0 to 100)", and always add
   that it is a coverage and practice indicator from our own unvalidated weights, not a
   score prediction and not a chance of passing. Give the guide `version`.

## plan

1. Run `readiness` for the exam, then the per-objective counts:

```bash
node ${CLAUDE_PLUGIN_ROOT}/src/cli/mentor-state.ts --data-dir ${CLAUDE_PLUGIN_DATA} exam-items --track '<code>'
```

2. Order the domains by `weight` times the gap that is left, and plan the top three,
   leaving out domains that cannot be practised. For each, pick the 2 or 3 objectives
   with the fewest questions, using the objective `summary` from `tracks --code '<code>'`.
   Pair each with a lesson on a mapped topic (`/m3l-mentor:teach <topic id>`) and
   a drill.
3. Spread it over one or two weeks with about 30 minutes a day. For a Professional exam,
   run `readiness` for the exam it `assumes` too, and put a weak Foundations domain
   first. When that readiness has `insufficient-evidence`, treat it as unknown, suggest a
   Foundations drill, and call it neither a gap nor a strength.
4. List any `external` frameworks as outside study, with their names and no content.
5. End by asking whether to start the first drill.
