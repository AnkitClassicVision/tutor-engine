# Evaluation plan

How Tutor Engine checks that it helps children learn, set down before results are looked at. The rules below are in the code (`src/engine/gain.ts`, `src/experiments.ts`, `src/runbook/`) and in this file; changing them means changing both, in the open.

## What counts as learning

Three groups of evidence, kept apart:

| Group | Measure | Where |
|---|---|---|
| Learning | Accuracy on **fair checks**: fresh questions the child had not seen, answered without a hint and graded with confidence. Highest Bloom band solved on their own per topic. Memory after 7 and 28 days. Use in a new situation (transfer). | Numbers page: ladder and "Progress on fair checks" |
| Independence | Hint rate on the child's own questions, supported versus independent successes, "Knows what they know" (sure answers that were right). | Numbers page: How learning is going |
| Engagement | Missions started per week, missions finished, time to the first question. | Numbers page |

A topic meets the full goal when it is solved on their own at the judging-and-creating band, remembered after a month and used somewhere new. When a memory step was shown only at a lower thinking level, the parent ladder says so, for example "Remembered after a week (at the basics level)".

**Access support versus the measured skill** (owner decision, 2026-10-19). Reading a question aloud and speaking an answer are recorded as access support. They leave a check independent unless they supply the skill being measured:
- in a reading subject (reading, phonics, decoding, literacy, English language arts), a question read aloud makes the attempt supported;
- in a spelling subject, a spoken answer makes the attempt supported.

Reading subjects are not read aloud automatically for ages 5–7; the Read aloud button stays. The skill is taken from the question's own subject name (`src/engine/access.ts`), not the mission's. Known limits: "Map reading" counts as reading, and plain "English" as reasoning. The rule is applied when attempts are read, so it covers every attempt with recorded access support: those since migration 022 (2026-10-19), including the few recorded that day before the rule. Earlier attempts have no access record and are unchanged.

## Before and after

For each child, the first six fair checks are compared with the latest six, at least a week apart, once there are twelve. The change is reported as accuracy before and after, the change in average Bloom level of the questions, Cohen's h with its size (under 0.2 too small to call, 0.2 small, 0.5 medium, 0.8 large), and 80% Wilson ranges. When the ranges overlap, the page says more checks are needed.

This describes a child against their own start. It does not show cause, and the topics in each window can differ. Cohen's h measures a change between two proportions; Bloom's 2-sigma result compared tutored students with a classroom group on standardized scores. The two scales are different, so an h value is never compared with 2 sigma, and the app never claims the benchmark.

The average Bloom level of each window describes the kind of thinking the questions asked for. It is not a measure of difficulty, and a rise in it is not reported as harder work.

## Is a fun feature helping?

A parent can switch on a week-on, week-off comparison for one feature at a time (now: the confidence choice or challenge missions). Every comparison alternates on the same weeks, so running two together could not separate them. The result is exploratory: order, carry-over, school, topics and time of year can all explain a difference. The rule is fixed in advance:

- **Enough data:** at least 2 whole weeks and 10 fair checks with the feature on, and the same with it off.
- **Keep:** missions per week no more than 10% lower with the feature on, and fair-check accuracy no more than 5 points lower.
- **Looks helpful:** as keep, and missions per week at least 10% higher.
- **Needs a rethink:** anything else. A feature that raises return but lowers learning is redesigned before it is offered more widely.

## Is the AI doing its job?

| Check | Rule |
|---|---|
| Every AI step | Runs from a versioned runbook with schema, self-check, code rules and repairs; failing output is pruned or refused, never shown. Golden cases for every step pass in CI. |
| Questions | A blind reviewer solves each one without the key and names the Bloom demand it really makes; disagreement or an overstated label drops the question. |
| Subject maps | Only links the web search returned may be cited; an independent subject-expert review checks accuracy and age fit; the parent approves before teaching. |
| Grades | The first grader must justify its grade: each rubric point, the learner's exact words that meet it, whether every stated reason is sound, and any doubts. Code refuses a verdict its own working does not support and any quote the learner never wrote. A grade counts only at 0.85 confidence or above and when an independent second grader, which never sees the first verdict, agrees. Anything under 0.85, or a disagreement, gets a grounding pass that works the answer out from the topic's own material (its idea, examples, and the subject map's success levels and misconceptions) and names what it relied on. If that is still under 0.85 or leaves a doubt, the answer goes to the parent with the reason, and counts neither way until the parent decides. |
| Human sample | Parents can check the AI's grades. A disputed grade counts neither way. The agreement rate is shown to the parent and reported by `scripts/runbook-health.ts`. |
| Models | `scripts/eval-runbooks.ts --confirm-spend` scores a model on every live golden case before it is recommended. |

Two AI judges agreeing is a filter, not proof of correctness; the human sample is what keeps the grading honest.

## What a pilot would add

The checks above work for one family. A claim about the program as a whole needs more: several families, a comparison condition, delayed checks at 7 and 28 days on unseen transfer tasks, and human-scored explanation and creation rubrics, with the analysis written down before the data is collected.
