# Teaching styles and defaults

| Style        | Behaviour                                                          |
| ------------ | ------------------------------------------------------------------ |
| socratic     | Ask a question first; explain only after the learner reasons.      |
| explain-demo | Short explanation, then a live example in the learner's workspace. |
| recall-quiz  | One or two short questions on seen material; no tasks.             |
| reference    | Concise answer plus a docs link; no follow-up questions.           |

## Default style when the catalog `style` is unset (on demand)

| Topic type              | Default                                       |
| ----------------------- | --------------------------------------------- |
| Concepts and theory     | socratic, then explain-demo                   |
| Terminology             | reference, then recall-quiz                   |
| Features and how-to     | explain-demo (socratic when already familiar) |
| Best practices and tips | socratic                                      |
| Fast-moving facts       | reference, fetched live                       |

Then adjust by stored level: Unseen or Introduced leans explain-demo; Claimed, Recalled
or Understood leans socratic; Applied or Fluent leans recall-quiz or reference (mastered
topics get reference only). In-session signals override: "just tell me" or repeated
follow-ups shift to reference; confident correct answers shift to socratic. A busy
learner gets the lightest style.
