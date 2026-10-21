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

For each child, the first six fair checks are matched to the latest six, at least a week apart, once there are twelve. All six must match by concept, Bloom demand, practice/transfer role and compatible response form. Known outcome or parallel-form conflicts cannot match. If a window changes from basic questions to higher-demand reasoning, the page withholds the change and effect-size labels and reports the matched count. Twelve answers alone are insufficient.

For complete matched windows, the change is reported as accuracy before and after, the change in average Bloom level of the questions, Cohen's h with its size (under 0.2 too small to call, 0.2 small, 0.5 medium, 0.8 large), and 80% Wilson ranges. When the ranges overlap, the page says more checks are needed.

This describes a child against their own start. It does not show cause: school exposure, elapsed time and other practice can change even with matched tasks. Cohen's h measures a change between two proportions; Bloom's 2-sigma result compared tutored students with a classroom group on standardized scores. The two scales are different, so an h value is never compared with 2 sigma, and the app never claims the benchmark.

The average Bloom level of each window describes the kind of thinking the questions asked for. It is not a measure of difficulty, and a rise in it is not reported as harder work.

## Comparable forms and delayed checks

An approved authored outcome/form identity means that the delivered prompt, key, controls and rubric match a bounded specification. It does not mean the variants have been empirically equated for difficulty. Other compatible same-topic/demand/role pairs remain historical proxies. A model cannot approve its own form merely by returning an ID.

The authored fractions route distinguishes equivalence, magnitude, like-unit addition, unlike-unit addition and choosing an operation. Its numeric cases use positive proper fractions, a denominator factor of two and a sum below one. Unlike-fraction addition requires one renaming. Analysis, judgment and construction use distinct tasks and explicit rubrics. The unfamiliar capacity task has a separate transfer form; it is excluded from calculation-retention pairs. See the original templates in `src/engine/fraction-forms.ts` and the live route test in `test/browser/learning-routes.spec.ts`.

A delayed measurement pairs with a prior eligible independent success at the same outcome, demand and role. Its interval ends when the question or sealed assessment starts, before feedback. A claim of an unrefreshed interval also needs recorded exposure coverage and a sufficiently long gap since related instruction, hints, worked examples, questions or feedback. Recent or unknown exposure does not become an exposure-free week. Report actual delay, matching status, support, missingness and sample counts; keep seven-day and longer follow-ups separate.

Confidence calibration uses answers that remained independent through submission and a revision-bound confidence capture. A hint after the confidence choice makes the response supported. Historical unknown capture order cannot establish independent calibration. Save acknowledgment, checker wait/run, visible feedback and estimated foreground work are separate timing observations; missing values stay missing, and foreground time is not measured thinking time.

## Is a fun feature helping?

A parent can switch on a week-on, week-off comparison for one feature at a time (now: the confidence choice or challenge missions). Every comparison alternates on the same weeks, so running two together could not separate them. The result is exploratory: order, carry-over, school, topics and time of year can all explain a difference. The rule is fixed in advance:

- **Enough data:** at least 2 whole weeks and 10 matched fair checks with the feature on, and the same with it off. Report unmatched checks separately; match topic, demand, role and compatible form before calculating the rates.
- **Keep:** missions per week no more than 10% lower with the feature on, and fair-check accuracy no more than 5 points lower.
- **Looks helpful:** as keep, and missions per week at least 10% higher.
- **Needs a rethink:** anything else. A feature that raises return but lowers learning is redesigned before it is offered more widely.

Enrollment records the comparison policy, decision rule and start timestamp. A missing or changed policy withholds a verdict; earlier and later policies are not pooled. These thresholds and delays are fixed implementation rules for an exploratory comparison, not evidence of an optimal schedule or universal success target.

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
