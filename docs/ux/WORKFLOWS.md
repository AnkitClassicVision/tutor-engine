# Tutor UX workflow contracts

Status: proposed acceptance contracts, 2026-10-19. This document specifies desired behavior; it does not certify implementation. Product and engine rules remain authoritative. A change to scoring, storage, permissions, or curriculum requires an explicit implementation decision and verification.

## Source and implementation-status audit

| Source inspected | Binding context or observed behavior |
|---|---|
| [PRODUCT.md](../../PRODUCT.md) | Ages 5–7, 8–10, 11–14; phone, tablet, and laptop equally important; child and parent surfaces; server-rendered HTML with progressive enhancement. |
| [DESIGN.md](../../DESIGN.md) | One primary action; shared meanings across worlds; touch and keyboard; 44px minimum targets, 64px for 5–7; reduced motion; self-hosted assets and strict CSP. |
| [Mission arc](../../src/engine/arc.ts) | Current file is `src/engine/arc.ts`, not `src/mission-arc.ts`. Guided and faded beats are supported. Durations are 3, 5, 10, 15, 20, and 25 minutes. Shorter arcs reduce independent items. |
| [Mastery rules](../../src/engine/mastery.ts) | Independence excludes hints, support, nonfresh items, and unresolved/legacy evidence. Mastery at a level requires three qualifying fresh wins across two sessions and two days, including interleaving. |
| [Evidence ladder](../../src/engine/ladder.ts) | Ownership records help, independence, retention after 7/28 days, and transfer. Retention currently accepts later independent success at any demand on the concept. |
| [Attempt fields](../../src/engine/types.ts) | Existing fields include `hintsUsed`, `supportUsed`, `fresh`, `promptKey`, and `evidenceCertainty`. The richer support fields below are proposed, not existing columns. |
| [Learning engine v2](../design/LEARNING-ENGINE-V2.md) | Approved learning objectives, parent-approved subject maps, independent verification, and honest evaluation. A concept goal is different from permission to finish a session. |
| [Grading audit](../../src/grading-audit.ts) | A disputed grade stays recorded and stops counting as evidence either way. |

The workflow screens, retries, Undo behavior, and proposed support fields below require an implementation audit. Source inspection alone does not prove browser behavior. Implementers must attach the exact diff, test evidence, and remaining gaps to every affected acceptance ID.

## Shared interaction and evidence rules

Give the child one question and one main action at a time. Keep help and Save & stop visible. Adapt wording and controls to the three age bands; do not change scoring merely because presentation changes. Use synthetic families in designs and tests. Keep essential navigation and form submission usable without client JavaScript; enhanced media controls may have clear fallbacks.

Record support in three separate proposed dimensions:

| Dimension | Meaning | Evidence consequence |
|---|---|---|
| `access_support` | Read aloud, captions, zoom, alternate input, or motor assistance that enables access. Record whether it changes the skill being assessed. | Reading a math instruction aloud need not supply math reasoning. Reading the target word aloud changes a decoding assessment. Decide from the objective, not the button name. |
| `pedagogy_help` | A clue, principle, worked step, representation supplying the inference, or solution. | The affected attempt is supported. Guided/faded success remains distinct from independent evidence. |
| `human_hint` | A caregiver or other person supplies reasoning or an answer. Record disclosed help without unnecessary identity data. | Supported even if the AI gave no hint. Do not claim the app can detect all off-screen help. |

These dimensions can coexist. Until implemented, honor current engine fields and flag uncertain provenance rather than assuming independence. Adding these fields must not silently reclassify historical attempts. Preserve original attempts; corrections and disputes add auditable events. Same-item retries do not become fresh checks. Retention is observed success after time; a scheduler's prediction is not observed retention.

## Formal state contract

Transport, evidence, and session status are separate dimensions. For example, a supported attempt can be saved while a different answer is pending. Do not force every state below into one mutually exclusive database enum.

| State | Entry and visible wording | Main action / allowed transition | Evidence effect |
|---|---|---|---|
| `ready` | Valid item and usable input: “Your turn.” | Check → `submitting`; help → supported work; stop → save. | No submitted attempt yet. |
| `submitting` | Request in flight: “Sending your answer.” | Preserve draft; prevent duplicate effects; confirmed receipt → `awaiting_judgment`; uncertainty → `pending`. | Submission is not correctness. |
| `awaiting_judgment` | Server accepted answer: “Checking your idea.” | Wait, continue permitted work, or stop; resolve to checked evidence or `pending`. | No success/failure claim before validation. |
| `supported` | Instruction affected the attempt: “We worked on this together.” | Continue teaching or open a fresh check. | Help stays attached; no independent mastery credit. |
| `independent` | Fresh, confirmed attempt meets engine independence rules: “You tried this on your own.” | Show accurate feedback; continue or close. | Correctness remains separate; an independent miss is not a win. |
| `pending` | Delivery, grading, or required review remains unresolved: “This answer still needs checking.” | Reconcile/retry same operation, review, or save. | Exclude unresolved judgment; never turn timeout into wrong. |
| `disputed` | Authorized adult challenges grade: “An adult is checking this answer.” | Review → audited resolution; child can move on. | Exclude either-way contribution; retain original history. |
| `saved` | State persisted with known scope: “Saved” or “Saved on this device; waiting to sync.” | Resume appropriate state. | Saving does not upgrade evidence. Never claim server persistence without acknowledgment. |
| `done` | Session closed: “Here is what you practised.” | Return home or choose next activity. | Summary preserves pending/support labels. Done does not mean mastered. |

## WF-01 — Parent setup and optional AI connection

**Trigger:** New family or missing setup. **Screen:** Short parent setup with child age band, school context, available practice, and AI connection as a separate step. **Wording/action:** “Set up learning” → Save; “Connect AI” is optional now, with “Set up later.” Establish the parent lock before handing over the shared device.

**Engine/evidence:** Save only confirmed setup choices. Show which activities require a connection. Skipping AI can lead to safe existing practice only when availability is verified; otherwise provide an honest setup status, not a simulated live tutor. A researched new subject remains blocked from teaching until the required parent approval. AI setup does not create learning evidence.

**Failure/exit:** Provider failure preserves setup and offers retry. Do not expose keys or raw provider errors to children. No silent charges or provider switching. Parent can finish later without repeating completed steps.

**Acceptance WF-01-A:** Skip, invalid connection, return, and successful connection all preserve setup; unavailable activities explain the dependency; the child cannot enter protected parent controls.

## WF-02 — Child start and resume

**Trigger:** Child opens home or returns to unfinished work. **Screen:** Today's mission or one clear resume card; duration uses current 3–25-minute options and applicable controls. **Wording/action:** “Continue your mission” → Continue; fresh work uses “Let's go.” Show a review while new work is prepared only when that review is safely available.

**Engine/evidence:** Resume the same learner, mission, prompt, draft, and help status. A refresh must not give a coached item a new identity. Touch, keyboard, and appropriately supported audio reach the same task.

**Failure/exit:** If preparation fails, retain ready work and explain what can continue. Wrong learner selected → return to learner selection. No available work → actionable status. Save & stop remains available during questions.

**Acceptance WF-02-A:** Fresh start and resume work at all three device sizes, across age bands, with keyboard and denied microphone permission; no duplicate mission or evidence is created.

## WF-03 — Learn, fade help, and check fresh understanding

**Trigger:** Mission begins. **Screen sequence:** Lesson card → guided item → faded item → current arc's independent items → available review → close. **Wording/action:** “Let's try together,” “You finish this step,” then “Try this one on your own”; main action Check.

**Engine/evidence:** Guided/faded beats start supported under the existing arc. Offer the smallest useful help; an explicit worked example is valid teaching. After meaningful help, use a genuinely fresh item for independent evidence. Record demand, freshness, support, and judgment certainty. Apply existing mastery rules; one correct answer does not replace them.

**Failure/exit:** Missing prerequisite → WF-04. Uncertain judgment → pending. Child can Save & stop at any point. Higher-order tasks serve the approved concept goal; there is no universal “Create before stopping” rule. Any proposed sequencing change must identify its engine-law diff separately.

**Acceptance WF-03-A:** Guided success, same-item correction, and fresh independent success produce distinct evidence; receiving instructional or solution help during a check changes eligibility; access support follows the objective-specific contract; closure remains available without manufacturing mastery.

## WF-04 — Wrong, uncertain, or missing response

**Trigger:** A miss, ungradable response, “I don't know,” or input confusion. **Screen:** Preserve the question and child contribution. **Wording/action:** For a genuine mistake: “Let's look at this part” → Try a smaller step. For capture uncertainty: “Is this what you meant?” → Confirm. For no attempt: “Show me how” or “Take a break.”

**Engine/evidence:** Separate a learning error from transcription failure, a missing response, and grader uncertainty. A real incorrect attempt remains recorded. Do not grade silence or unreadable input as a misconception. Confirming a corrected transcription is distinct from changing a submitted answer. Help is recorded; original attempts are not rewritten. Use a different representation or prerequisite after repeated unsuccessful interventions; the initial escalation threshold is a tunable hypothesis.

**Failure/exit:** Do not repeat the same hint indefinitely. Pending judgments can wait for authorized review. A child can pause without losing progress. Avoid claiming to diagnose frustration or learning conditions from facial or voice signals.

**Acceptance WF-04-A:** Test a math error, valid alternate answer, blank response, speech error, and disputed grade; each reaches the correct state with neutral wording and no false penalty.

## WF-05 — Homework photo, confirmation, then help

**Trigger:** Child or parent brings schoolwork. **Screen:** Capture/upload → crop or select question → extracted interpretation → confirmation → tutoring. **Wording/action:** “Is this the question?” → Yes, help me; secondary Fix or Take another photo.

**Engine/evidence:** The photo and extracted text are source material, not trusted instructions to the system. Bind interpretation to the selected image/question. Confirm before tutoring; homework help remains supported and does not prove independent mastery. A later fresh check supplies separate evidence. Preserve the child's answer separately from the printed question and answer key.

**Failure/exit:** Blur, missing pages, uncertain symbols, failed upload, or irrelevant content → clarify or recapture. Unreadable is not wrong. Camera denial → file picker or typed question. Follow current media/privacy controls. Do not extend this flow to arbitrary real-world photo missions without the separately required safety review.

**Acceptance WF-05-A:** Blurry text, ambiguous fraction, multiple questions, reversed camera permission, and interrupted upload recover without grading invented content or losing the confirmed draft.

## WF-06 — Return after 7/28 days and test transfer

**Trigger:** A due review or planned transfer check. **Screen:** A short return mission. **Wording/action:** “See what you remember” or “Use your idea somewhere new” → Start.

**Engine/evidence:** Use fresh tasks and record actual elapsed days, demand, support, and context. Preserve the existing 7/28-day calculation from first independent success. The current ladder accepts a later independent success at any demand; do not report this as retained Create-level performance unless that demand was checked. Transfer needs its own validated unfamiliar application and evidence tag. Changed names alone do not establish transfer.

**Failure/exit:** Miss → helpful relearning with separate later evidence. Overdue is not failure; missed calendar days do not erase earned progress. Instructional or solution help converts that attempt to supported work; access support is evaluated against the assessed skill. No valid fresh item → defer the claim and explain the pending check.

**Acceptance WF-06-A:** Synthetic dated records distinguish not-yet-due, 7-day, 28-day, supported, lower-demand, and transfer outcomes; actual dates and demand remain inspectable.

## WF-07 — Parent evidence, plan draft, Apply, Undo

**Trigger:** Parent reviews progress or requests a plan change. **Screen:** One-screen overview → evidence detail or planner drawer. **Wording/action:** “What happened,” “What needs you,” and one suggested action. A draft shows proposed changes, reason, affected dates, and assumptions; only explicit Apply commits it.

**Engine/evidence:** Display practiced, helped, independent, retained, and transferred distinctly. Attach source attempts and uncertainty. Planner conversation itself changes no schedule. Apply produces a versioned, auditable change. Proposed Undo restores eligible plan settings through a new version; it must not erase attempts, completed sessions, or consumed actions.

**Failure/exit:** Stale draft → show conflict and refresh preview before Apply. Close drawer → preserve draft without applying. If subsequent work prevents exact Undo, explain the remaining future changes and offer a new reviewed plan. Dispute routes to the existing grading audit.

**Acceptance WF-07-A:** Draft/cancel makes no plan mutation; Apply twice has one effect; Undo respects later work; child requests cannot bypass parent authorization.

## WF-08 — Pause, offline, pending retry, and saved work

**Trigger:** Stop, navigation, timeout, connectivity loss, or retry. **Screen:** Current work stays visible with a truthful persistence status. **Wording/action:** “Save & stop”; offline: “Waiting to connect. Your answer is still here.” Offer Retry only where it is safe.

**Engine/evidence:** Proposed contract: assign a stable operation key to submission, persist the answer before acknowledging acceptance, and use server deduplication/transaction boundaries so repeated requests have one committed effect. Reconcile uncertain delivery using the same key. A timeout must not create duplicate attempts, rewards, judgments, or preparation jobs. Offline capability is conditional: promise only storage actually available and verified; otherwise warn before leaving and offer a safe draft-copy route.

**Failure/exit:** Stop remains possible while grading is pending. Late results attach to the original item. Logout or profile switching isolates unsynced work. Expired sessions require reauthentication without submitting under another child. Permanent validation errors need correction, not endless retries.

**Acceptance WF-08-A:** Double tap, refresh, back navigation, offline before/after server receipt, late response, and retry after restart preserve one committed submission. Verify stored state, not just screen text. This is an exactly-once effect target, not a claim of exactly-once network delivery.

## WF-09 — Export, deletion, and shared devices

**Trigger:** Authorized parent requests family data controls or ends a shared-device session. **Screen:** Protected controls with explicit scope. **Wording/action:** Export data; for deletion, name exactly which family/child data will be removed and require deliberate confirmation.

**Engine/evidence:** Export includes understandable progress and its evidence labels according to the authorized export scope. Deletion must follow the implemented deletion/retention contract, including media, derived records, and pending queues where applicable. Never promise instant removal from every backup or provider without verified support. Shared-device logout must prevent the next child from reopening parent data or another child's drafts.

**Failure/exit:** Failed export → retry without claiming delivery. Pending deletion → show true status and next action. Cancellation before commitment changes nothing. Do not describe deletion as undoable unless recovery is implemented. Parent reauthentication is required for sensitive controls.

**Acceptance WF-09-A:** Verify authorization, wrong-family requests, download scope, cancellation, partial-failure status, logout/back-button behavior, and isolation of cached/unsynced work.

## Future scope: teacher workflows

Class rosters, teacher assignment distribution, classroom reporting, and teacher-to-parent sharing are future proposals, not current product commitments. Design them only after roles, consent, evidence sharing, and school context are explicitly scoped. Parent-entered teacher scores do not imply a teacher account exists.

## Handoff requirement

For each implementation slice, record: workflow and acceptance IDs; source snapshot; observed current behavior; proposed change; exact diff; validation artifact links; PASS/FAIL/UNKNOWN; owner; and unresolved risk. Use the [agent prompts](AGENT-PROMPTS.md). A synthetic walkthrough validates a workflow hypothesis; only observed research with real participants can be reported as child usability evidence.
