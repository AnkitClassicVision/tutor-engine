# UI/UX process series

Status: **proposed workflow; not executed**. No child observations, prototype studies, family pilot, delayed learning checks, or rollout results are claimed here.

This process turns a product goal into observed, tested changes. Read [PRODUCT.md](../../PRODUCT.md), [CONTRIBUTING.md](../../CONTRIBUTING.md), [DESIGN.md](../../DESIGN.md), and [EVALUATION-PLAN.md](../EVALUATION-PLAN.md) first. Use [QA-SCORECARD.md](QA-SCORECARD.md) for definitions and release decisions.

## Boundaries and operating rules

- Design for ages **5–7, 8–10, and 11–14**. Phones, tablets, and laptops have equal priority. The parent surface has equal priority with the child surface.
- Keep server-rendered HTML and small progressive-enhancement scripts. This series does not authorize a client-framework rewrite, new analytics service, or automatic changes to a child's plan.
- Preserve fresh independent evidence, the parent lock, explicit **Apply** for planner proposals, school context, and family export/deletion. Presentation support and subject difficulty are separate decisions.
- Keep current target rules: **44 CSS pixels or greater; 64 pixels for ages 5–7**. These are repository commitments. WCAG 2.2 AA has a different 24-pixel minimum with exceptions; 44 pixels is its enhanced AAA criterion. Assess full accessibility, not target size alone. [S1]
- Use synthetic learners and synthetic schoolwork in code, issues, screenshots, recordings attached to development work, and review packs. Real research records remain in an approved restricted location outside the repository, under a defined deletion policy.
- Use existing minimal first-party records where adequate. Additional research is opt-in, with guardian consent and age-appropriate child assent. A child can pause or withdraw without losing ordinary service. Avoid recording by default; never assume existing service consent covers research. [S3–S5]

Roles below are responsibilities, not extra hires. One person can hold several roles; name the accountable person on each work card. A release owner cannot waive a blocking defect by averaging scores.

## UX-01 — Set outcomes and audit the current product

**Purpose:** Define the improvement before choosing a new appearance.

**Owner role:** Product lead. **Inputs:** Product documents, current screens, source routes, existing tests, known family feedback.

**Method**

1. Choose one child outcome and one parent outcome, such as resuming a mission and understanding what needs adult attention.
2. Trace current behavior from route to screen to saved evidence. Record observed behavior separately from code expectations and untested assumptions.
3. Inventory the three age bands and three device classes, including loading, empty, error, permission, and parent-lock states.
4. Classify friction by task failure, incorrect learning evidence, accessibility barrier, parent misunderstanding, and cosmetic inconsistency.

**Outputs:** Baseline task inventory, evidence-linked audit, ranked hypotheses, scope boundary.

**Exit gate:** Every claimed defect has evidence or is labeled unverified; no outcome is defined only as screen time or visual preference.

**Handoff:** Research lead receives questions to observe in UX-02.

## UX-02 — Observe children and parents

**Purpose:** Discover what users actually misunderstand or need help with.

**Owner role:** Research lead. **Inputs:** Audit, approved research information, recruitment criteria, synthetic scenarios.

**Method**

1. Propose **5–6 children per age band** for a formative round, with parent participation. This is a planning sample, not statistical proof or a representative population.
2. Include differing reading ability, accessibility needs, language backgrounds, ordinary devices, and unreliable connectivity. Document gaps in recruitment.
3. Explain the activity to the guardian and child. Obtain appropriate consent and assent; agree a simple stop signal. Do not collect diagnoses or extra personal information merely to fill a persona.
4. Observe starting, answering, asking for help, stopping, and parent interpretation. Allow unaided action before a standardized rescue; record the rescue instead of silently coaching.

**Outputs:** De-identified findings, intervention log, needs matrix, open questions. Store only synthetic examples or non-identifying summaries in this repository.

**Exit gate:** Findings distinguish participant evidence from researcher inference; withdrawal and data handling worked as explained. [S2–S5]

**Handoff:** Journey designer receives observed barriers.

## UX-03 — Map journeys and friction

**Purpose:** Improve the complete family experience, including recovery.

**Owner role:** UX designer. **Inputs:** Observations and current task inventory.

**Method**

1. Map child start/resume, mission, help, independent check, photo submission, pause, and next session.
2. Map parent setup, AI connection, classes/results/notes, overview, proposed plan, explicit Apply, export, and deletion.
3. At every step record intent, information needed, action, system response, decision, and recovery. Identify handoffs on a shared device.
4. Rank friction by consequence and frequency, stating when frequency is unknown. Keep learning struggle distinct from interface struggle.

**Outputs:** Journey maps, recovery map, prioritized intervention points.

**Exit gate:** Both users can reach a meaningful finish; every critical failure has an intended recovery owner and path.

**Handoff:** Designer and learning lead define contracts in UX-04.

## UX-04 — Specify state and evidence contracts

**Purpose:** Prevent a smoother interface from producing misleading learning records.

**Owner role:** Learning lead, with engineering review. **Inputs:** Journeys, existing engine rules, evaluation plan.

**Method**

1. For each transition specify trigger, visible state, allowed action, saved event, retry behavior, and termination condition.
2. Separate guided, faded, independent, pending judgment, disputed, remembered later, and transfer evidence. Hints and guided steps never become mastery.
3. Define what counts as access support versus instructional help for each objective. Reading a math prompt aloud can differ from reading aloud when decoding is the assessed skill; do not silently redefine current scoring.
4. Specify invalid photo, unclear speech, model uncertainty, duplicate submit, disconnect, and permission denial. A technical failure never becomes an incorrect knowledge answer.
5. State parent authorization boundaries and what the child can see about parent access.

**Outputs:** State table, evidence table, recovery copy, synthetic acceptance cases.

**Exit gate:** Every visible claim has a valid evidence state; disputed or ungradable work remains unknown.

**Handoff:** Prototype designer receives executable examples, not vague screen names.

## UX-05 — Compare low-fidelity alternatives

**Purpose:** Test the interaction structure before polishing it.

**Owner role:** UX designer. **Inputs:** Contracts and ranked friction.

**Method**

1. Sketch two or three approaches to the same task, including the current approach where useful. Vary structure, not several unrelated features at once.
2. Use the same synthetic lesson and parent evidence in every alternative.
3. Compare next-action clarity, help discovery, reading burden, parent interpretation, and recovery on all device classes.
4. Ask users to do tasks before asking which version looks nicer. Preserve reasons for rejecting an option.

**Outputs:** Comparable sketches, decision record, remaining hypotheses.

**Exit gate:** A selected approach solves a named barrier without losing required workflows; preference alone does not determine the winner.

**Handoff:** Design-system owner specifies the chosen approach in UX-06.

## UX-06 — Define tokens, content, and accessibility

**Purpose:** Make the chosen structure consistent and usable across worlds and ages.

**Owner role:** Design-system owner. **Inputs:** Selected approach, DESIGN.md, accessibility requirements.

**Method**

1. Reuse semantic tokens and existing components before adding new ones. Separate theme appearance from learning meaning.
2. Specify age-band density, target dimensions, text wrapping, focus, contrast, non-color status cues, reduced motion, and screen-reader names.
3. Write short, concrete action labels and error messages. Keep one primary next action; allow help and stopping without making them visually disappear.
4. Define keyboard and non-drag pointer alternatives, read-aloud behavior, and clear camera/microphone status. Test permission explanations at the point of use.

**Outputs:** Component/state checklist, copy inventory, token change proposal, accessibility checks.

**Exit gate:** Meaning survives a theme switch, zoom, reduced motion, and non-visual access. Apply W3C cognitive guidance as well as automated checks. [S1–S2]

**Handoff:** Prototyper builds realistic behavior in UX-07.

## UX-07 — Build a realistic prototype

**Purpose:** Expose interaction failures that static mockups hide.

**Owner role:** Prototype engineer. **Inputs:** Components, contracts, synthetic cases.

**Method**

1. Prototype the chosen child journey and corresponding parent summary using repository-compatible HTML and progressive enhancement.
2. Include realistic long text, early-reader copy, delayed responses, empty history, wrong answers, pending grades, and failed photo recognition.
3. Provide touch and keyboard routes on phone, tablet, and laptop; include shared-device parent locking.
4. Label mocked responses and timing. A simulation does not prove live AI speed, grading quality, security, or persistence.

**Outputs:** Reviewable prototype, synthetic scenario list, mocked-versus-live inventory.

**Exit gate:** Research participants can reach task states without the facilitator manually advancing screens.

**Handoff:** Research lead runs UX-08.

## UX-08 — Test child usability and parent comprehension

**Purpose:** Check whether people can act and understand the resulting evidence.

**Owner role:** Research lead. **Inputs:** Prototype, task script, consented formative cohort, scorecard.

**Method**

1. Give age-appropriate tasks and a consistent starting point. Counterbalance alternatives when comparing them.
2. Record interface help separately from learning help. A wrong answer can still be a successful usability task.
3. Ask parents what was done independently, what needs review, and what they must do next. Test Apply versus proposal and parent-lock behavior.
4. Test an interruption, a permission refusal, and Save & stop. Ask children what the AI is and whether it can be wrong.
5. Fix blocking barriers and repeat affected tasks with fresh participants where practical; label repeat-user familiarity.

**Outputs:** Counts with denominators, cohort coverage, findings, revised contracts.

**Exit gate:** No known blocking path failure in tested contexts; untested contexts remain unknown, not passed.

**Handoff:** Engineering lead receives the validated scope for UX-09.

## UX-09 — Build one complete vertical slice

**Purpose:** Deliver one usable improvement through the existing system.

**Owner role:** Engineering lead. **Inputs:** Revised contracts, prototype, synthetic acceptance cases.

**Method**

1. Select a bounded child flow and its parent consequence: for example, resume → answer/help → evidence saved → parent understands the result.
2. Implement server-rendered behavior first; add enhancement for convenience while retaining essential form and navigation behavior.
3. Preserve strict CSP, self-hosted assets, authorization checks, and existing storage conventions.
4. Add meaningful tests for changed evidence, scheduling, permissions, or recovery behavior. Use existing first-party events; propose any missing measurement before collecting it.

**Outputs:** Reviewable change, synthetic fixtures, relevant tests, rollback method, instrumented-versus-unknown inventory.

**Exit gate:** The child task and parent interpretation work against real persistence in the test environment; no framework rewrite or analytics expansion is bundled in.

**Handoff:** QA owner performs UX-10.

## UX-10 — Verify quality, privacy, security, and evidence

**Purpose:** Establish a release decision from checks of actual behavior.

**Owner role:** QA owner. **Inputs:** Implemented slice, scorecard, changed-file inventory.

**Method**

1. Run required repository type, unit, and browser gates. Inspect accessibility manually as well as with axe.
2. Verify relevant age/device/input combinations, slow connections, retries, and restoration of saved work.
3. Verify parent boundaries, privacy notices, export/deletion effects, and that untrusted uploaded text cannot authorize actions. Do not spend through a model account without the required authorization.
4. Check supported versus independent evidence and unknown/disputed handling using synthetic cases. Review actual claims on parent screens.
5. Record failures and limitations. Run the judge template in the scorecard; an average score never waives a blocker.

**Outputs:** Dated QA evidence, failure owners, release/hold recommendation.

**Exit gate:** Required gates pass; critical unknowns are resolved before exposing the affected flow to families.

**Handoff:** Pilot lead opens UX-11 only for the approved scope.

## UX-11 — Run a real-family learning pilot

**Purpose:** Learn whether usability gains accompany useful independent learning.

**Owner role:** Pilot lead, with learning-evaluation review. **Inputs:** Approved slice, predeclared measures, recruited families, data plan.

**Method**

1. Obtain appropriate research consent/assent. Declare cohort, comparison approach, scoring rubric, delayed-check windows, and missing-data handling before seeing outcomes.
2. Measure interface independence, learning independence, parent clarity, and healthy endings separately.
3. Use fresh fair checks, delayed checks at 7 and 28 days, and new-context transfer tasks. Human-review a defined sample of model judgments.
4. Track outside instruction and changed topic difficulty as context; do not claim a small convenience sample proves causation.
5. Treat week-on/week-off observations as exploratory: order, learning carryover, school instruction, and time trends can explain differences.

**Outputs:** De-identified pilot report, uncertainty, retention/transfer follow-up schedule, actionable issues.

**Exit gate:** Report only matured outcomes; pending 28-day evidence remains unknown. Do not equate a within-child effect with Bloom's 2-sigma result.

**Handoff:** Release owner sets exposure limits for UX-12.

## UX-12 — Roll out gradually and improve weekly

**Purpose:** Keep quality visible after release.

**Owner role:** Release owner. **Inputs:** QA results, matured pilot findings, rollback plan, open uncertainties.

**Method**

1. Expand to a named, limited cohort with an existing release mechanism; a new flag system is not required by this document.
2. Review failures, confusing evidence, parent support needs, and healthy completion weekly. Keep delayed learning outcomes on their actual schedule.
3. Stop expansion for blockers. Revert or disable affected behavior while preserving valid learner records.
4. Choose one highest-consequence improvement, create a SMART card, and repeat the relevant steps. Recheck changed models and content as well as UI.

**Outputs:** Release decision log, weekly scorecard, next improvement card, rollback evidence.

**Exit gate:** Each expansion has a named owner, sufficient evidence for its scope, and an explicit list of unknowns.

**Handoff:** Product lead starts the next bounded cycle at UX-01.

## Proposed delivery sequence

This is a planning schedule, not completed work or a promise that research recruitment will fit it. Recruitment, access needs, or blocking defects extend the timeline.

| Period | Work and concrete review |
|---|---|
| Week 1 | UX-01–03: audit, consented observation, child and parent journeys. Confirm the research sample and missing contexts. |
| Week 2 | UX-04–07: contracts, alternatives, tokens/copy/accessibility, realistic synthetic prototype. |
| Week 3 | UX-08–09: formative iteration and one implemented child-to-parent slice. Retest affected tasks. |
| Week 4 | UX-10: verify; start UX-11 only when gates pass. Publish findings available so far and a dated follow-up roster. |
| Week 5 onward | Continue UX-11; collect 7-day checks when due. UX-12 may allow a limited rollout if appropriate, with unresolved learning outcomes clearly identified. |
| 28-day follow-up | Collect after each participant's relevant independent learning event, not 28 days after project kickoff. A cohort starting in week 4 normally reaches this in week 8 or later, subject to recruitment and assessment windows. |

**Not performed by creating this series:** participant recruitment, consent, observation, usability sessions, product changes, QA execution, paid model evaluation, a family pilot, or rollout.

## Reusable SMART work card

```text
ID / title: UX-__ / [one observable outcome]
Type: Exploration | Execution
Accountable owner: [person and role]
Due date: [absolute date and timezone]
User / age band / device / context: [...]
Problem and evidence: [source, date, observed count; assumptions marked]
Specific outcome: [child task AND parent consequence]
Measure: [numerator, denominator, cohort, observation window]
Target: [proposed target, not a claimed benchmark]
Deliverables: [exact files, change, research summary, or decision]
Constraints: [evidence rules, privacy, accessibility, architecture]
Dependencies / handoff: [input owner, next owner, required state]
Method: [numbered actions]
Acceptance gate: [observable behavior and required checks]
Blocking defects: [conditions that prevent acceptance]
Research/data handling: [consent, minimal records, storage, deletion]
Rollback or stop condition: [...]
Evidence at completion: [actual result, limitations, links]
Decision: Accepted | Revise | Hold | Unknown
```

## Primary design references

- **S1:** [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/), including target size, keyboard access, dragging alternatives, focus, contrast, and reduced-motion criteria. Conformance levels differ.
- **S2:** [W3C cognitive accessibility summary](https://www.w3.org/TR/coga-usable/summary.html): clear content, recovery, reduced memory burden, adaptation, and participation of people with cognitive and learning disabilities. Supplemental guidance, not proof that a specific UI works.
- **S3:** [UNICEF Guidance on AI and Children, version 3](https://www.unicef.org/innocenti/reports/policy-guidance-ai-children), December 2025: inclusion, safety, privacy, transparency, and child wellbeing.
- **S4:** [ICO Children's Code transparency guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/4-transparency/): explanations at the moment of data use and developmental adaptation. UK guidance is used here as a design reference; applicability requires its own assessment.
- **S5:** [FTC final COPPA rule changes](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data): parental consent for covered under-13 services, deletion, and limited retention. This workflow does not determine legal compliance.
