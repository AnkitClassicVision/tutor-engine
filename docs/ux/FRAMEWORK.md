# Tutor Engine: a framework for excellent child and parent UX

**Status:** proposed product and delivery framework. Repository review completed on 2026-10-19 UTC (2026-10-18 in New York), against `97b0295982f0925abce49d54065309ae453a3487`. No child study, production usability test, learning experiment, or UI implementation was performed for this documentation change.

## The product promise

**A child can start, understand the next step, get useful help, show what they learned, and stop with confidence. A parent can see what happened and know the next useful action.**

World-class UX is a goal to earn through observed outcomes. An attractive theme, an AI panel's score, automated accessibility checks, and passing software tests each provide different evidence. None establishes that children learn well or use the product independently.

Keep three outcomes separate:

| Outcome | Question | Evidence |
|---|---|---|
| Interface independence | Can the child operate the tutor without an adult navigating for them? | Observed start, answer, help, recovery, resume and finish tasks. |
| Learning independence | Can the child solve or explain a fresh task without solution assistance? | Valid fresh attempts, help history, later retrieval and transfer. |
| Healthy willingness to return | Does the child want another useful session and feel free to finish? | Voluntary return, stopping behavior and research conversations, considered alongside learning. |

**Remove navigation friction and protect useful thinking.** Reading a confusing menu is wasted effort. Comparing two mathematical explanations can be valuable effort. Unlocking adult settings is protective effort. Do not optimize all three away with a single click-count metric.

## 1. Build from the current product

[PRODUCT.md](../../PRODUCT.md) defines children aged **5–14**, with **5–7, 8–10 and 11–14** bands. Phones, tablets and laptops matter equally. Parents matter equally. The current implementation uses server-rendered HTML and small progressive-enhancement scripts.

Preserve these foundations:

- The concept graph, prerequisite evidence, school context and short missions.
- Guided, faded, independent and review beats, with helped work kept separate from mastery.
- Parent-made child access, locked adult surfaces, explicit Apply for planner changes, and undo/history.
- Existing worlds, age-sensitive presentation, manipulatives, media alternatives and recovery work.
- Self-hosted assets, strict content-security policy, family isolation, export and deletion.
- Session limits, saved partial work, truthful capability status and a verified recovery path when a provider is unavailable.

The current README acknowledges that teaching has not been validated with real children at scale. That is the main evidence gap. The October 16 review is historical; several features it called unbuilt exist in the reviewed code and tests. See [REPO-AUDIT.md](REPO-AUDIT.md).

### Scope of “everyone”

For this release, “everyone” means the declared child bands and parents across the supported devices, reading abilities, input methods and relevant access needs. It does not mean one identical screen serves every person. Teacher accounts, school rosters, adult learners and institutional deployment are future product scopes that need their own requirements.

School material and teacher marks are already important inputs. A teacher portal is a different feature. Keep that distinction visible in the backlog.

## 2. Understand the learner before choosing screens

Age is a starting presentation default. Keep **reading support**, **subject readiness**, **motor/input needs**, **language**, **sound** and **motion** separately adjustable. A strong mathematician can still need questions read aloud. Reduced animation does not imply reduced speech.

| Person or situation | Recommended presentation | What stays constant | First test |
|---|---|---|---|
| Ages 5–7 | One short spoken/visible instruction, concrete pictures, large answer targets; preserve the repo's 64px target rule. | Honest evidence, a meaningful goal, help and stopping rights. | Wrong answer → hear help → respond → finish, without an adult explaining the controls. |
| Ages 8–10 | Brief text with optional audio; manipulatives and short explanations; a visible small goal. | Same learning model and recoverable work. | Homework capture → confirm question → guided practice → new attempt. |
| Ages 11–14 | Calmer presentation, more choice of explanation depth, quick input and substantial reasoning tasks. | No pressure to appear advanced; access supports remain available. | Challenge task → disagree with feedback → review → stop. |
| Parent with one minute | A short account of independent work, what is uncertain and one useful action. | Ability to inspect evidence and control changes. | Explain what the child can do and what needs attention. |
| Shared tablet, poor signal or denied microphone | Clear ownership, input alternatives, saved state and truthful capability status. | No lost work or false grading from a technical failure. | Switch child → resume → fail a submission → recover safely. |

W3C's cognitive-accessibility guidance supports clear text, familiar controls, recoverable context and involving people with cognitive and learning disabilities in design. It supplements WCAG; it does not guarantee usability for all children. [Source: W3C cognitive accessibility](https://www.w3.org/TR/coga-usable/summary.html).

### Research questions that change the design

Observe the child and parent separately before helping. Ask concrete questions:

1. What does the child think will happen when they press the main button?
2. Where does the parent need to explain the interface, rather than the subject?
3. Does the child distinguish a hint, a checked answer and an unfinished check?
4. What happens after the second confusing explanation, an unreadable photo or a lost connection?
5. Does the parent understand an independent success differently from a helped success?
6. Can both people tell what is saved, what the parent sees and how the child stops?

Use observation to revise assumptions. Do not infer a fixed “learning style,” diagnosis, attention span or emotion from clicks, face or voice.

## 3. Make the experience legible at three scales

| Scale | What the child needs to know | Interface expression |
|---|---|---|
| This moment | What am I doing and how do I respond? | One task, one primary action, persistent help, hear/read options, Save & stop. |
| This mission | Why this task and when am I finished? | One concrete goal, simple stage markers, a chosen time budget and a satisfying close. |
| My learning | What can I now do and what comes next? | Evidence-based milestones with examples; one recommended return. |

### Child home

Make Continue or the current mission the main action. Show the small goal and a short reason. Homework and exploration remain secondary routes. Choose a sensible duration from the existing settings; put changing it behind one clear control. Avoid asking a child to select a concept ID, Bloom level, algorithm, provider or instructional strategy.

### Learning workspace

The stable screen has: a goal/stage cue, the current task, the response area, one submit/continue action, and predictable help/exit controls. New representations and explanations appear where the task is, rather than forcing a child to search a conversation history. A chat can help; a blank chat box should not be the only route through a structured lesson.

### Finish

State one demonstrated accomplishment and any unresolved check. Make Done for today easy to see at the planned endpoint. Offer at most one immediately visible continuation in the proposed design. Preserve the child's ability to choose more, within the parent's cap, without an automatic next lesson.

### Parent overview

Keep the existing compact overview. Its meaning should be understandable in one glance:

- **What held:** “Solved two fresh fraction problems on their own.”
- **What needs another look:** “An explanation is waiting for review.”
- **What you can do:** “Ask them to show why the pieces need the same size.”

Details belong behind evidence links. A model proposes plan changes with a before/after preview; the parent explicitly applies them. Correction and undo preserve history.

## 4. Make help improve capability

The system should first identify whether the difficulty is an interaction problem, a content misunderstanding or uncertainty in the tutor's judgment.

| Situation | Recommended response | Evidence treatment |
|---|---|---|
| Microphone heard “fifteen” instead of “fifty” | Let the child correct the captured response. | Input failure; no mathematics failure. |
| Child cannot read the mathematics instructions | Read them without solving the problem. | Record access support; preserve eligibility when the objective permits it. |
| Child does not know which principle to use | Offer one focused cue or a related worked example. | Pedagogical assistance; this attempt cannot establish unaided mastery. |
| Child keeps trying the same misconception | Change the representation or probe a prerequisite. | Record an evidence-based hypothesis, not a permanent label. |
| Model is uncertain or two judges disagree | Explain that checking is unfinished and route to review. | Pending/unresolved; do not count as correct or incorrect. |
| Child thinks the tutor made a mistake | Preserve the response and open a review concern. | Dispute workflow; never let self-report directly award success. |

**Accessibility support and solution help need separate records.** Reading the prompt aloud can be appropriate for a mathematics check. Reading the target passage aloud during a decoding assessment changes the skill being assessed. The objective determines the rule.

Use a flexible support sequence: clarify the input → orient attention → cue a principle → show a representation → model a related example → teach the current problem. Children should not have to fail repeatedly to earn an explanation. After teaching, ask a fresh question when the child is ready. Short sessions may save this check for a later block.

The proposed “two unsuccessful interventions → change approach” rule is a starting hypothesis for testing. It is not a research-established optimum.

## 5. Protect the meaning of learning evidence

In a 2025 field experiment with nearly 1,000 high-school mathematics students, unrestricted AI access improved assisted practice but reduced subsequent unassisted grades by 17% relative to control. A more guarded tutor largely mitigated that harm; it did not establish a general learning improvement. The ages, subject and AI systems differ from this product. The useful design implication is to assess what remains when solution assistance is removed. [Source: Bastani et al., PNAS](https://doi.org/10.1073/pnas.2422633122).

Keep the engine's current rules authoritative until an explicit, tested policy change is accepted. The UX must truthfully represent them. Useful display labels are:

| Label | Meaning |
|---|---|
| Practiced with help | The child completed supported work. |
| Did this independently | A specific fresh task was solved without solution help; this alone is not broad mastery. |
| Remembered later | A valid check after a recorded delay supports retention. |
| Used it somewhere new | A reviewed task supports a specified kind of transfer. |
| Still checking | A judgment or interpretation remains unresolved. |
| Needs another look | New evidence suggests more teaching or verification. |

Use examples, dates and evidence counts behind each status. Untested is unknown. A school score without item-level information does not diagnose a concept gap. Uploaded correct work with unknown outside help is not automatically independent evidence.

### Use Bloom to design tasks

The revised taxonomy distinguishes cognitive processes and knowledge types and permits overlap between categories. It is useful for task coverage, not an interval scale of a child's intelligence or a rigid ladder that every short session must climb. [Source: Krathwohl, 2002](https://www.psychology.mcmaster.ca/bennett/psy720/readings/m1/m1r1.pdf).

| Process | Fractions example | Evidence requirement |
|---|---|---|
| Remember / understand | Name a half and explain the denominator. | Accurate meaning, not a memorized label alone. |
| Apply / analyze | Add unlike fractions and locate the error in a worked solution. | Correct method and identification of the relevant relationship. |
| Evaluate / create | Compare two methods; build a fair-sharing example and defend it. | A valid rubric for the objective and evidence of the child's contribution. |

Task demand, content difficulty, freshness, assistance, retention and transfer are separate axes. Higher Bloom labels do not automatically mean harder material. A creative product can still depend on a tutor doing most of the reasoning.

### Repair misleading comparisons first

The reviewed code computes Cohen's h for first-six/latest-six accuracy and compares a value of 2 to Bloom's 2-sigma benchmark in parent-facing copy. Those quantities are not interchangeable. Remove that equivalence and describe the comparison as an exploratory progress snapshot. Do not average Bloom labels into “N levels harder.” Week-on/week-off feature comparisons are also vulnerable to time, content and simultaneous-feature confounding. See [REPO-AUDIT.md](REPO-AUDIT.md) and [QA-SCORECARD.md](QA-SCORECARD.md).

## 6. Make fun come from useful achievement

The existing worlds are an advantage: a child can choose a look without changing the control layout or evidence rules. Improving a common component benefits every world. Test the least legible and most distracting theme states too; a calm default alone does not validate every theme.

Recommended signature experiences:

| Experience | Learning action | Guardrail |
|---|---|---|
| Teach the tutor | Correct an explicitly framed practice mistake and explain why. | An educator verifies the planted mistake and resolution; distinguish it from a real system error. |
| Museum of changed minds | Compare the child's original explanation with their own revision. | Reward the quality of revision, not automatic completion or an AI rewrite. |
| Build something real | Make a recipe, short story, model or experiment using a concept. | Store an appropriate artifact and assess the relevant skill with a rubric. |
| A choice inside the mission | Choose a context, example or representation. | Keep choices bounded and preserve the objective. |
| Return to a remembered idea | Reconstruct a connection or solve a short fresh variation later. | Do not count looking at an answer as retrieval. |

Do not add lost-streak guilt, endless feeds, distress from a companion, or rewards based only on minutes. UNICEF's guidance supports agency, healthy independence and avoiding engagement optimization at the expense of wellbeing. These are product principles; the best implementation still needs child testing. [Source: UNICEF Child Centric AI](https://www.unicef.org/digitalimpact/stories/child-centric-ai).

## 7. Make accessibility part of the component contract

Propose **WCAG 2.2 AA** as the updated evaluation target. The current repository references WCAG 2 AA; this document does not assert 2.2 conformance. Retain the repo's 44px minimum touch targets and 64px junior targets. WCAG 2.2's AA minimum target criterion is 24×24 CSS pixels with exceptions; 44×44 is the enhanced AAA target criterion. The repo deliberately uses larger product targets. [Source: WCAG 2.2](https://www.w3.org/TR/WCAG22/).

For each component, define visible label, screen-reader name, focus behavior, keyboard actions, tap alternative, loading and failure state, saved state, age-sensitive copy, zoom/reflow behavior and motion/audio preferences. Test control meaning without color. A drag exercise needs a simple pointer alternative as well as keyboard access. Keep help in a consistent place.

Use progressive enhancement. Core responses and navigation should remain usable when an optional script or media feature fails. Check actual iPad Safari and a real phone for permission prompts, speech, soft keyboards and focus; desktop WebKit and a mocked camera cannot establish those device experiences.

## 8. Make privacy and adult control understandable

The child should know it is an AI learning tool, that it can make mistakes, and what the parent can see. Explain microphone/photo processing at the moment it is requested. Declining an optional permission must lead to a useful alternative when the learning objective permits one.

For covered U.S. under-13 services, the FTC describes verifiable parental consent requirements and parent deletion rights, with data-minimization and retention obligations. A normal parent account is not, by itself, evidence that the full consent process is adequate. Verify the deployment's actual duties and processor behavior before a public family pilot; do not label the app compliant because its settings screen exists. [Source: FTC final COPPA changes](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data).

Preserve the repository's no-real-child-data rule for issues, fixtures and screenshots. Use synthetic records in this repo. Research data belongs in an appropriately restricted location under a retention plan. Build on minimal first-party operational records; do not add third-party tracking scripts to create a UX dashboard.

## 9. Turn every screen into a workflow contract

For every journey, write:

1. **Trigger and person:** Who arrives, why, with what permissions and saved state?
2. **Success and meaning:** What should they accomplish and understand?
3. **Interaction:** What is visible, the primary action, and the next state?
4. **Evidence:** What counts as learning, help, input repair, unresolved or no attempt?
5. **Recovery:** What happens with no AI, timeout, duplicate tap, permission denial, wrong capture, interruption and account switch?
6. **Exit and return:** What is saved, what is discarded, how do they stop, and what reappears later?
7. **Verification:** Which code contract, human observation and learning check establish success?

A screen with only a happy path is an incomplete specification. Refer to [WORKFLOWS.md](WORKFLOWS.md) for the nine journey contracts and [PROCESS-SERIES.md](PROCESS-SERIES.md) for the 12-step production process.

## 10. Recommended execution order

**First:** correct evidence wording, preserve coaching drafts until acknowledgement, decouple speech/motion, and make AI capability messages consistent. These come from concrete code findings.

**Next:** test the complete early-reader wrong-answer → help → fresh attempt → finish journey. Use a non-number task as well as number tiles. Compare two simple interaction variants before changing the whole product.

**Then:** build one complete vertical slice, test recovery on real devices, and run a repeated-use family pilot with later checks. A four-week build schedule cannot prove 28-day retention for children who start in week four.

**Expand after evidence:** reuse the approved components for other subjects, worlds and contexts. Keep teacher accounts, institutional administration and dedicated hardware outside this first UX improvement batch unless a measured need justifies them.

The operating rule is simple: one child problem, one measurable improvement, one complete journey, and an honest decision to keep, revise or stop the change.
