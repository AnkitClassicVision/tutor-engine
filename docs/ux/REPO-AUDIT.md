# Tutor UI/UX: current repository audit

**Inspected base:** `97b0295982f0925abce49d54065309ae453a3487` (2026-10-18).

**Method:** read-only inspection of product/design documents, implementation and targeted test definitions. No application, production session or test suite was run for this audit. A test file establishes intended coverage; it does not establish that the test currently passes. Recommendations below are proposed work, not implemented fixes.

**Conclusion:** preserve the current foundation. Correct the trust and recovery gaps, complete the early-reader journey, then validate it with children and parents. A new visual theme alone will not establish world-class usability.

## Existing work to preserve

| Capability found in code | Implementation and intended coverage |
|---|---|
| Three age bands, parent override, large early-reader controls | [age.ts](../../src/engine/age.ts), [age-band tests](../../test/age-band.test.ts), [browser age-band tests](../../test/browser/age-bands.spec.ts) |
| Guided, faded, independent and review beats; interactive teaching models | [arc.ts](../../src/engine/arc.ts), [manipulatives.ts](../../src/manipulatives.ts), [mission-arc tests](../../test/mission-arc.test.ts), [browser manipulatives tests](../../test/browser/manipulatives.spec.ts) |
| Compact parent overview and separate task pages | [journey-view.ts](../../src/journey-view.ts), [parent-overview tests](../../test/browser/parent-overview.spec.ts) |
| Planner proposals, explicit Apply, history and undo | [planner.ts](../../src/planner.ts), [planner browser tests](../../test/browser/planner.spec.ts) |
| Independent evidence, unresolved grades, parent grading disputes | [mastery.ts](../../src/engine/mastery.ts), [grading-audit.ts](../../src/grading-audit.ts), [verifier tests](../../test/verifier.test.ts) |
| Camera/audio lifecycle, answer recovery and repeat-safe photo saves | [session.js](../../public/session.js), [journey.js](../../public/journey.js), [device tests](../../test/browser/devices.spec.ts), [recovery tests](../../test/browser/recovery.spec.ts) |
| Retrieval during waits, non-attempt handling and learning measures | [waiting-review tests](../../test/waiting-review.test.ts), [non-attempt tests](../../test/non-attempt.test.ts), [learning-metrics.ts](../../src/learning-metrics.ts) |

The [October 16 panel review](../design/TOP-1-PERCENT-REVIEW.md) is **historical**. Its “Next round (not built)” list is stale: several listed features now have implementations and tests. Its panel scores and screen heights must not be repeated as current measurements or an industry percentile.

## Prioritized changes

### 1. P0 — Correct the parent-facing learning claims

**Confirmed reporting issue.** [gain.ts](../../src/engine/gain.ts), `gainOnFairChecks()`, calculates Cohen’s h from first-six/latest-six accuracy. Both the [evaluation plan](../EVALUATION-PLAN.md) and [view.ts](../../src/view.ts), `progressSection()`, say a value of 2 would match Bloom’s benchmark. Cohen’s h is not interchangeable with a standardized mean difference or a two-standard-deviation effect.

The same view describes increased average Bloom level as questions getting “harder.” Cognitive demand and content difficulty are distinct; Bloom categories are not established equal-interval difficulty units. [experiments.ts](../../src/experiments.ts), `armFor()`, also assigns all enrolled features the same odd/even week phase. Simultaneous feature changes cannot isolate either feature’s effect.

**Smallest change:** remove the h-to-2σ equivalence; label before/after summaries descriptive and week-on/week-off comparisons exploratory. Describe task types without treating their category numbers as difficulty distances. Initially compare one feature at a time, or report the combined change explicitly.

**Validation:** synthetic changes in topic mix must not create efficacy claims. Review all related UI and documentation together. A later causal study needs matched measures and a predeclared comparison design.

### 2. P1 — Complete the early-reader journey

**Shared copy confirmed; usability impact unobserved.** [view.ts](../../src/view.ts), `sessionPage()`, uses largely shared batch-feedback, checkpoint and recap text across ages. [journey-view.ts](../../src/journey-view.ts), `cameraPage()`, presents title, subject, material type, work state and transcription controls. [age.ts](../../src/engine/age.ts), `numberChoices()`, supplies tiles only for suitable whole-number answers.

**Smallest change:** apply an age-sensitive interaction contract to question → hint → correction → finish. For ages 5–7, present one short instruction and decision at a time. Add Hear this to necessary help/status content. Default or defer upload metadata that a child cannot confidently supply. Preserve evidence rules across bands.

**Validation:** observe a 5–7-year-old recovering from a wrong answer and an unreadable photo, including a non-number task. Count adult explanations of the interface separately from teaching help.

### 3. P1 — Make connection promises consistent

**Confirmed contradiction; unavailable-provider behavior not executed.** [ai-connect.ts](../../src/ai-connect.ts), `welcomeAiPage()`, says practice missions work without a connection. [journey-view.ts](../../src/journey-view.ts), `studentHome()`, says the tutor cannot check answers or help, while retaining Let’s go. `parentTools()` contains both “Checks, hints and curriculum building fail” and “Practice can start.”

**Smallest change:** derive all messages and actions from one verified capability state. Offer an activity that actually works, or a clear parent handoff. Keep the existing quick-connect path; do not redesign authentication merely to fix inconsistent copy.

**Validation:** cover no connection, valid connection, revoked access, exhausted usage and unavailable photo model. Both surfaces must describe the same capabilities and offer a successful next action. Extend [AI-welcome tests](../../test/browser/ai-welcome.spec.ts) beyond skipping setup to the resulting learning flow.

### 4. P1 — Separate reading preferences from motion preferences

**Confirmed behavior.** [session.js](../../public/session.js) suppresses automatic speech when `prefers-reduced-motion` is enabled. A child can need both less animation and read-aloud. Its `tutor-autoread` preference is also stored once per device, so it can carry between siblings.

**Smallest change:** control motion and automatic reading separately. Make learner/device preference ownership explicit. Retain Tap to hear when the browser prevents automatic audio.

**Validation:** independently combine motion on/off and reading on/off. Switch between two children on one device. Required reading support must not disappear merely because motion is reduced.

### 5. P1 — Define access support separately from teaching help

**Assessment-contract gap inferred from inspected code.** [mastery.ts](../../src/engine/mastery.ts), `independent()`, checks freshness, hints, support and certainty. [services.ts](../../src/services.ts), `loadAttempts()`, derives support mainly from hints and homework mode. [session.js](../../public/session.js) provides question narration without a task-specific assessment policy in that handler.

**Smallest change:** define the skill being measured for each task and distinguish access support from instructional help. Reading a math question aloud may preserve a math assessment. Reading the target word aloud during a decoding assessment may supply the skill being tested. Voice entry can preserve reasoning while changing what a spelling task measures. Do not classify every accessibility aid as a hint or assume every aid preserves independence.

**Validation:** paired math/decoding and reasoning/spelling cases must retain the right evidence label. Teaching support must never be withheld merely to keep an independence score.

### 6. P1 — Protect coaching drafts through failed submissions

**Handler coverage confirmed; data-loss outcome inferred.** [journey.js](../../public/journey.js) saves answer drafts and `/help` textareas, but [view.ts](../../src/view.ts) uses `form.talk` for checkpoint and post-mission questions outside that selector. Covered non-answer drafts are cleared on submit, before server acknowledgement. [Recovery tests](../../test/browser/recovery.spec.ts) protect answers but do not establish the same guarantee for coaching text.

**Smallest change:** preserve coaching drafts until acknowledged. Scope storage to learner, session and conversation. Handle intentional discard and ownership changes explicitly.

**Validation:** type or dictate a question, fail its submission, reload and recover it. Retry after a saved response is lost without duplicating the message. A sibling must never receive the draft.

### 7. P1 — Give children a route to question a grade

**Parent route exists; child action absent in reviewed feedback templates.** [grading-audit.ts](../../src/grading-audit.ts) provides a parent “I disagree” action that removes the grade from evidence. [view.ts](../../src/view.ts), `sessionPage()`, offers help and another question without a comparable explicit child concern action.

**Smallest change:** offer “I think there’s a mistake” on relevant feedback. Preserve the prompt, answer and original verdict; route to parent review. Define when evidence becomes unresolved. The child must not award themselves mastery.

**Validation:** test an incorrect key and an equivalent correct explanation. The parent receives the exact disputed work; repeated taps create one concern; adjudication updates evidence correctly.

### 8. P1 — Obtain direct family and device evidence

**Confirmed validation limitation.** [README.md](../../README.md) identifies synthetic-family testing and says real-child teaching is not validated at scale. [playwright.config.ts](../../playwright.config.ts) includes desktop browsers and Pixel 7 Chromium, with no explicit tablet or mobile Safari project. [device-fixture.ts](../../test/device-fixture.ts) simulates media and speech, including modeled playback in headless WebKit.

**Smallest change:** run observed tasks across all three age bands and parents, explicitly including phone, tablet and laptop. Spot-check physical Safari devices, virtual keyboards, speech permissions and relevant assistive technology. Test start, answer, recovery, resume and finish before expanding automation.

**Validation:** keep tested contracts, directly observed problems and untested hypotheses distinct. Passing axe checks is one input; it does not prove cognitive accessibility or unaided task success.

### 9. P2 — Make the planned finish easy to recognize

**Hierarchy confirmed; behavioral impact untested.** [view.ts](../../src/view.ts), `nextStepChooser()`, can show Next mission, Quick review, One more round, Explore another topic and I’m done. Next mission is primary; Done is last and secondary. Save & stop already exists in [server.ts](../../src/server.ts).

**Smallest change:** at planned completion, show one accomplishment and a prominent Done for today. Offer one optional continuation, with additional options disclosed later. Distinguish completion from a paused mission.

**Validation:** children can finish without help and know their work is saved. Continuing must respect the parent’s time limit. Measure successful stopping alongside voluntary return.

### 10. P2 — Measure what the learner actually experiences

**Confirmed instrumentation limitation.** [learning-metrics.ts](../../src/learning-metrics.ts) uses `shown_at - started_at`; [server.ts](../../src/server.ts) records `shown_at` before page delivery. [services.ts](../../src/services.ts) adjusts `started_at` during pause/resume accounting. [performance.ts](../../scripts/performance.ts) measures synthetic local HTTP latency and explicitly disclaims production certification.

**Smallest change:** separate start-requested, question-visible, feedback-visible and completion events. Keep original timestamps immutable; record paused duration separately. Collect aggregate timing without raw answer text.

**Validation:** slow network, AI delay, resumed sessions and background tabs must produce interpretable timings. Retain existing server metrics with their narrower scope clearly stated.

## Migration boundaries and first batch

Follow [PRODUCT.md](../../PRODUCT.md) and [DESIGN.md](../../DESIGN.md): server-rendered HTML, progressive enhancement, no client framework, strict CSP, self-hosted assets, existing age/device support, parent locking and explicit Apply. Preserve independent-evidence semantics, existing URLs, saved work and the six worlds during incremental changes.

Start with evidence wording, draft recovery, independent accessibility preferences and consistent connection states. Then observe the early-reader recovery/finish workflow before adding screens or changing the brand. Expand the test matrix only to resolve a concrete risk. This audit authorizes no deployment and makes no claim that proposed fixes have shipped.
