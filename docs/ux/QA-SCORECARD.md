# UI/UX and learning quality scorecard

Status: **proposed pilot targets; no measured results**. Every result starts **Unknown**. Creating this scorecard does not establish usability, accessibility conformance, security, learning efficacy, or delayed retention.

Use with [PROCESS-SERIES.md](PROCESS-SERIES.md) and [EVALUATION-PLAN.md](../EVALUATION-PLAN.md). Keep separate measures separate. A child can operate the interface independently while needing teaching; a fluent interface can still teach poorly.

## Measurement contract

Record the release, task/content version, age band, device class, input method, observation dates, cohort size, and exclusions. Cover ages **5–7, 8–10, 11–14**, child phone/tablet/laptop use, and parent use on those devices. Report untested combinations as unknown; do not imply that one participant covers every accessibility need.

Use existing minimal first-party records and consented research observation. Missing measurements require an explicit instrumentation decision; this document does not introduce third-party analytics, session replay, background recordings, or collection of diagnoses. Keep child-identifying records, photos, audio, transcripts, and research consent records outside the repository. Publish synthetic examples and safe aggregates only; suppress small combinations that could identify a family.

**All numerical cutoffs below are proposed planning and pilot targets.** They are not researched benchmarks, established mastery thresholds, validated population norms, or measured outcomes. Agree them before examining results, and document revisions without relabeling earlier failures as passes.

| State | Meaning |
|---|---|
| Unknown | No valid measurement, insufficient coverage, or follow-up not yet due. |
| Pass for tested scope | Predeclared target met with the denominator and limitations shown. |
| Revise | Target missed or a non-blocking weakness needs a named action. |
| Blocked | A critical defect prevents affected exposure regardless of other results. |

Display counts beside percentages. A formative sample of 5–6 children per age band is a **proposed discovery sample**; one child changes a percentage substantially. Do not call its percentage a population estimate or treat repeated attempts from one child as independent participants.

## Separate outcome panels

### 1. Interface independence

**Question:** Can the child operate the tutor without someone explaining the controls?

- **Numerator:** Core task attempts completed after a standardized introduction with no adult navigation instruction or physical intervention.
- **Denominator:** All observed assigned core task attempts; count abandoned tasks and rescues as unsuccessful. A setup interruption may be excluded only under a predeclared rule and remains reported.
- **Tasks:** Start/resume, submit, find help, recover from one failure, and Save & stop. Report every task separately by age/device; show participant counts too.
- **Proposed target:** At least **90%** unaided completion, with no known critical task inaccessible in a tested context. Any intentional access accommodation is recorded, not silently counted as coaching.
- **Initial result:** **Unknown — no participants observed.**

Wrong subject answers do not make a navigation task fail. Conversely, an adult finding the Check button makes interface independence fail even if the child's answer is correct. W3C's cognitive guidance supports clear structure, mistake recovery, and testing with actual users. [Q1]

### 2. Learning independence

**Question:** Can the child solve fresh work without instructional help?

- **Numerator:** Correct fair checks: fresh unseen questions, independently answered, confidently graded under the existing evaluation rules.
- **Denominator:** Correct plus incorrect eligible fair checks. Report supported attempts, duplicate/exposed items, ungradable answers, and disputed grades separately with their counts; never erase them from the participation picture.
- **Cohort/window:** Report by child, topic and comparable task set, with cognitive demand and item difficulty documented separately. The current first-six/latest-six summary is a pooled descriptive snapshot; it does not establish matched topics or item difficulty. A comparable per-topic analysis requires its own defined eligibility and instrumentation.
- **Proposed target:** At least **70%** independent accuracy on a predeclared, suitable check set, and no unexplained fall greater than **5 percentage points** on comparable checks. These are review triggers, not promotion rules; a change in task demands can explain a change in accuracy.
- **Initial result:** **Unknown — no new fair-check evidence collected.**

Track hint/help use separately without rewarding children for avoiding needed teaching. Showing a solution and then collecting the same answer never becomes independent evidence.

### 3. Parent clarity and control

**Question:** Can the parent understand the learning record and make the intended decision?

- **Numerator:** Correct interpretations of four prompts: what happened, what was independent, what remains uncertain, and what needs the parent next.
- **Denominator:** All four prompts for every participating parent; count “cannot tell” explicitly. Show counts by prompt, device, and participant.
- **Proposed target:** At least **90%** correct interpretation; **100%** of tested plan changes remain proposals until explicit Apply. Any actual unauthorized change is a blocker, not an acceptable error rate.
- **Additional tasks:** Unlock/relock on a shared device, inspect AI connection state, and find export/deletion. Test their actual effects in a synthetic family.
- **Initial result:** **Unknown — no parent comprehension sessions performed.**

Privacy explanations must match behavior. Explain parent visibility to the child in age-appropriate terms. [Q3]

### 4. Reliability and accessibility

**Question:** Does the task remain usable across input methods, failures, and ordinary devices?

- **Numerator:** Passed predefined acceptance scenarios.
- **Denominator:** All applicable required scenarios; pending or skipped critical scenarios remain unknown and cannot establish readiness.
- **Proposed gate:** **100%** of critical scenarios pass; no unresolved task-blocking accessibility defect or critical/high automated finding in the changed flow. Automated scanning alone never proves conformance.
- **Scenarios:** Keyboard, touch, visible focus, screen-reader task route, text zoom, reduced motion, contrast/non-color meaning, 44px+ targets and 64px for ages 5–7, long content, denied permissions, slow/offline transitions, duplicate submission, retry, and saved-state restoration. Check progressive-enhancement fallback for applicable core flows.
- **Optional proposed performance targets:** UI acknowledgment p95 within **200 ms** and an already-prepared question usable p95 within **3 seconds**, on declared devices/network conditions. Measure from action to actual acknowledgment or usable content. Report sample count, errors, and live AI preparation time separately; a spinner is not a usable question.
- **Initial result:** **Unknown — this document did not execute checks.**

Use existing required repository commands (`npm run typecheck`, `npm test`, `npm run test:browser`) and checks relevant to the change. Do not run paid or production-impacting evaluations merely to fill a scorecard. WCAG 2.2 distinguishes keyboard access from non-drag pointer alternatives and AA from AAA criteria. [Q2]

### 5. Healthy completion

**Question:** Can children reach a useful endpoint and leave without pressure?

- **Numerator:** Mission starts ending in a planned finish or deliberate Save & stop with work preserved and the child understanding what comes next.
- **Denominator:** All observed mission starts; report finishes, deliberate pauses, unexplained abandonment, technical failures, and missing outcomes separately.
- **Proposed target:** At least **90%** understandable, preserved endings. Also report the ordinary finish rate; combining it with safe pauses must not hide low completion.
- **Blocking behavior:** Lost work on a promised save, stopping obstructed by rewards, or a companion using guilt/distress to demand more use.
- **Initial result:** **Unknown — endings and resumption not observed.**

Do not optimize minutes consumed as the learning outcome. UNICEF recommends agency and healthy independence rather than engagement at the expense of wellbeing. [Q4]

### 6. Learning retention after 7 and 28 days

**Question:** Is previously demonstrated knowledge still available without help?

- **Assessment cohort:** Child-topic opportunities with prior independent evidence and a scheduled follow-up. Define eligibility before outcomes are known.
- **Windows, proposed:** Days **7–9** and **28–32** from the first eligible independent success, consistent with the current engine. Record exact elapsed days. Earlier checks remain separate observations and cannot establish a 7/28-day label. A research protocol with different timing produces a separate study measure and does not change the engine's retention status.
- **Numerator:** Correct, confidently graded independent responses on fresh, comparable delayed items.
- **Denominator:** All confidently graded eligible delayed responses. Also report **coverage**: assessed child-topic opportunities divided by all opportunities due. Show supported, disputed, missed, and not-yet-due counts separately.
- **Proposed targets:** At least **70%** independent accuracy at each window and **80%** coverage of due opportunities. Below-target results trigger investigation; missing children are not assumed either successful or unsuccessful.
- **Initial results:** **7-day: Unknown. 28-day: Unknown.**

Report child-level distributions and cohort counts rather than pooling every item into one misleadingly precise number. Keep learning retention distinct from product return rate.

### 7. Transfer

**Question:** Can the child use the idea in an unfamiliar context?

- **Numerator:** Fresh new-context tasks meeting a predeclared subject rubric without hints or a worked example of that task.
- **Denominator:** All eligible, confidently judged transfer attempts. Report pending/disputed judgments and nonparticipation alongside the result.
- **Cohort/window:** Child-topic opportunities with prior instruction; specify timing, novelty, cognitive demand, access support, and rubric before assessment.
- **Proposed target:** At least **60%** independently successful transfer on the declared pilot set. This is an initial design target, not a universal standard for mastery.
- **Human check:** Blind-review a predeclared sample, and all materially disputed high-level judgments. Report sampled/eligible counts, disagreement, and resolution; model agreement alone is not validation.
- **Initial result:** **Unknown — no transfer tasks administered.**

Changing numbers in the same question template is not sufficient evidence of new-context transfer. The existing evaluation plan calls for fresh tasks and human-scored explanation/creation rubrics.

## Blocking defects and statistical cautions

**Hold the affected release for:** supported work labeled as mastery; uncertain or disputed grades presented as established facts; parent authorization bypass; exposure of another family's records or credentials; real child data in repository artifacts; unsafe generated content reaching children; a critical task inaccessible; destructive recovery or lost saved work; missing critical verification. Passing engagement or performance never offsets one of these defects.

**Known claim problem to resolve separately:** EVALUATION-PLAN.md currently says a change of 2 “on this scale” would match Bloom's benchmark size after describing Cohen's h. **Do not repeat that claim in UI or reports.** Cohen's h describes a difference between proportions; Bloom's 2-sigma comparison concerns standardized performance differences between instructional groups. Their numerical magnitudes are not interchangeable. Resolved in plan step 1 (2026-10-19): the evaluation plan and parent view no longer compare h with 2 sigma; the calculation is unchanged.

Average Bloom demand is **not question difficulty**. A difficult recall item and an easy creation task can occupy different places on those dimensions. Report demand and empirical/calibrated difficulty separately; rising mean demand does not itself prove improvement.

Week-on/week-off pilots have order, practice, carryover, topic, schoolwork, and time confounds. Treat them as exploratory unless a suitable comparative design supports stronger claims. Existing 80% Wilson intervals are descriptive uncertainty estimates; overlap or non-overlap alone does not establish causality. Repeated answers from one learner are clustered, not independent child samples. Do not invent confidence percentages from a few observations. Predeclare analysis; report missing follow-up and recruitment bias.

For reference, [Bloom's original 1984 paper](https://web.mit.edu/5.95/readings/bloom-two-sigma.pdf) describes its instructional-group comparison; [statsmodels' official proportion-effect documentation](https://www.statsmodels.org/stable/generated/statsmodels.stats.proportion.proportion_effectsize.html) gives the transformed-proportion formula used for h. Their different definitions explain why the numerical values cannot be equated. Product effectiveness requires an appropriate evaluation design, not matching a convenient number.

## Reusable release judge

```text
JUDGE INPUT
Release / scope / owner / date:
Evidence: [commands/results, synthetic scenario IDs, consented aggregate findings]
Population/context: [age, device, input, parent, connectivity; missing cohorts]
Panel results: [numerator/denominator, timing, proposed target, limitations]
Blocking-defect register: [open/closed, evidence, owner]
Follow-up due: [7-day, 28-day, transfer; actual dates]

JUDGE METHOD
1. Reject unsupported claims and evidence from the wrong release or population.
2. Check blockers first. One unresolved blocker => HOLD affected release.
3. Treat missing critical checks as UNKNOWN => HOLD affected exposure.
4. Judge each panel separately. Never substitute an average for a failed gate.
5. Distinguish a usable tested slice from proven learning effectiveness.
6. Confirm consent/data boundaries, rollout scope, stop rule, and rollback.

OUTPUT
Decision: HOLD | REVISE | LIMITED PILOT | EXPAND TESTED SCOPE
Reasons: [short evidence-linked statements]
Allowed scope / prohibited inference:
Remaining unknowns / follow-up dates:
Required actions: [owner, due date, concrete evidence needed]
Recheck trigger: [changed flow, model, scoring, privacy behavior, new cohort]
```

## Primary design references

- **Q1:** [W3C cognitive accessibility guidance](https://www.w3.org/TR/coga-usable/summary.html). Supplemental design guidance, not a child-usability benchmark.
- **Q2:** [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [dragging alternatives](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html). Testable criteria and supporting explanations; assess applicable conformance levels accurately.
- **Q3:** [ICO Children's Code standards](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/code-standards/). Child-facing transparency, high privacy defaults, and visible parental controls. Used as a design reference, not a determination of jurisdiction.
- **Q4:** [UNICEF Child Centric AI](https://www.unicef.org/digitalimpact/stories/child-centric-ai), April 2026. Developmental appropriateness, clear AI identity, agency, and healthy independence.
