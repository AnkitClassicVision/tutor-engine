# Orchestration: prompt 1 output

Prompt: [AGENT-PROMPTS.md](AGENT-PROMPTS.md) §1, Orchestrator, with the shared assignment contract. Process step: UX-01. Snapshot: private main at `17f49d0` (2026-10-19), after round 1 ([PLAN.md](PLAN.md)). Method: code and test inspection. "Test" means a test exists and passed in the last run of that suite: unit 355/355 and browser 188/188 before the round 1 review fixes; the post-fix four-browser run is M0. No child or parent was observed. This is not usability evidence.

Status key: **PASS** means every clause has a code path and a passing test. **PARTIAL** means some clauses do. **UNKNOWN** means there is no evidence either way. **GAP** means the code does not do it.

## 1. Workflow coverage (WF-01 to WF-09)

| Acceptance | Status | Clause by clause, with evidence |
|---|---|---|
| WF-01-A Setup and AI connection | PARTIAL | Skip, invalid key and successful key preserve setup: `test/browser/ai-welcome.spec.ts` (first two tests). No-AI screens say the same thing and what they promise works: the same file, third test. Child cannot reach parent controls: `test/journey-http.test.ts` "student mode blocks parent APIs…", `test/browser/parent-access.spec.ts`. **GAP:** revoked access, used-up plan and missing photo model are only reported when a job fails, not on the setup or home screens (`src/services.ts` `aiConnectionProblem` checks configuration only). **UNKNOWN:** returning to setup later without repeating finished steps (no test). |
| WF-02-A Start and resume | PARTIAL | Start, stop and resume for both presentations: `test/browser/journey.spec.ts:73`; resume keeps the draft and tiles: `test/browser/adaptive.spec.ts`, `test/age-band.test.ts:34`. Denied microphone keeps the typed draft: `test/browser/devices.spec.ts:68`. Keyboard: unlock only (`journey.spec.ts:148`) and manipulatives; **UNKNOWN** for a whole mission by keyboard. Phone (Pixel 7) and desktop sizes run; **UNKNOWN** for tablet, because there is no tablet project in `playwright.config.ts`. No duplicate mission: `test/adaptive.test.ts:75`. |
| WF-03-A Learn, fade, fresh check | PARTIAL | Guided, faded, same-item and fresh independent evidence stay distinct: `test/adaptive.test.ts:32,75`, `test/ladder.test.ts:18`. Help during a check makes it supported: `src/engine/mastery.ts` `independent()`, `test/adaptive.test.ts:32`. Closure without mastery: Done for today in `test/browser/adaptive.spec.ts`. **Open policy:** access support is recorded (round 1, step 7) but no objective-specific rule exists for decoding or spelling. |
| WF-04-A Wrong, uncertain, missing | PARTIAL | Maths error with neutral feedback: `test/browser/feedback.spec.ts:8`. Valid alternate answer: `test/engine.test.ts:210` (equivalent rationals). Blank or "I don't know" is asked again without scoring: `test/non-attempt.test.ts:28`. Disputed grade: `test/verifier.test.ts:82` plus the child concern (round 1, step 5). **UNKNOWN:** a speech-recognition error (the simulated microphone does not inject wrong words). |
| WF-05-A Homework photo, confirm, help | **GAP** | Camera denial keeps the form: `devices.spec.ts:50`. A repeated save makes one record: `recovery.spec.ts:43`. Unreadable work stays unresolved: `test/adaptive.test.ts:174`. **GAP:** there is no "Is this the question?" step before tutoring. The child goes from the transcribed list straight to "Let's think it through" (`src/journey-view.ts` material page), and only a parent can fix a transcription. **UNKNOWN:** blurry text, an ambiguous fraction and several questions on a page (no synthetic cases). |
| WF-06-A 7/28 days and transfer | PARTIAL | Help, independence, memory and transfer stay apart: `test/ladder.test.ts:18,53`. An early check cannot stand in for a 7-day one: `test/adaptive.test.ts:130`. **UNKNOWN:** an explicit 28-day boundary case, and a lower-demand later success labelled as such (the current ladder accepts any demand; WORKFLOWS.md flags this). |
| WF-07-A Parent evidence, Apply, Undo | PARTIAL | Talking with the planner changes nothing until Apply: `test/planner.test.ts:67` (`:52` checks proposal validation). Applying twice has one effect: `src/planner.ts:291` ("Already applied"), **no test**. Undo from history: `test/undo.test.ts:26`, `planner.spec.ts:131`. Undo respects later work: `src/undo.ts` `undoCheck`, partly covered by `test/pack.test.ts:197`. Child cannot reach it: `journey-http.test.ts:325`. **UNKNOWN:** a stale draft after the plan changed, which should show a conflict before Apply. |
| WF-08-A Pause, offline, retry | PARTIAL | Failed answer submission keeps the answer: `recovery.spec.ts:18`. A duplicate answer makes one attempt: `submitAnswer` `priorSubmission`, `test/adaptive.test.ts:75`. A repeated question to the tutor sends once: round 1, step 2. A late status cannot remove a finished destination: `recovery.spec.ts:70`. **UNKNOWN:** back-navigation and offline after the server received the answer; retry after a browser restart. **Known limit:** two simultaneous homework-help sends (round 1, D5). |
| WF-09-A Export, deletion, shared device | PARTIAL | Export carries the record and no secrets: `test/hardening.test.ts:500`. Deletion leaves nothing readable and keeps going through storage failures: `family-crypto.test.ts:63,99`, `hardening.test.ts:251,271`. Logout without a child selected: `hardening.test.ts:73`. Siblings isolated after refresh: `journey-http.test.ts:83`. **UNKNOWN:** whether the back button after logout shows cached parent pages, a wrong-family export request (only authorization in general is tested), and cancelling deletion. |

Summary: 0 of 9 acceptance checks fully pass, 8 are partial and 1 has a gap. Round 1 moved WF-01, 03, 04 and 08 forward. WF-05 is the only workflow where a core step of the contract does not exist.

## 2. Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-10-19 | Round 2 runs the six prompts in order (M1–M6), then family sessions (M7). | Owner asked for the package to be carried out prompt by prompt, with milestones, criteria and board tracking. |
| 2026-10-19 | **Next slice: WF-05, confirm the homework question before help.** | It is the only gap in a core child step. It touches one child flow and one parent consequence (a parent fix of the transcription). WORKFLOWS.md specifies it closely, and it needs no scoring change, since homework help is already supported evidence. |
| 2026-10-19 | M3 also writes contracts for WF-06, WF-07 and WF-09, but M4 and M5 build only WF-05. | Smallest complete slice first. The other three are partial with specific unknowns, recorded above as test additions for later slices. |
| 2026-10-19 | Tablet size and keyboard-only mission go into the M6 QA scope, not into a new build. | They are coverage gaps, not missing behaviour. |

## 3. Next slice: WF-05 confirm before help

- **Acceptance:** WF-05-A (blurry text, ambiguous fraction, several questions, camera permission reversed, interrupted upload) plus WF-04-A for unreadable work.
- **Child task:** after the photo is read, the child sees "Is this the question?" with the transcribed text, then chooses Yes, help me, Fix it (edit the text), or Take another photo. Tutoring starts only after Yes.
- **Parent consequence:** the parent sees which questions the child confirmed or corrected; a child's correction is kept beside the original reading and never replaces the original photo.
- **Files M5 may touch:**
  - `src/journey-view.ts` (material and guidance pages)
  - `src/journey-routes.ts` (`/questions/:id` routes)
  - `src/schoolwork.ts` if storage needs it
  - a migration only if a confirmation field is required
  - `public/journey.js`
  - tests under `test/` and `test/browser/`
- **Excluded:** photo missions (separate safety review), any change to how homework evidence counts, and model or provider changes.

## 4. Implemented, verified, still proposed

- **Implemented and verified (code and tests):** round 1 steps 1–8 ([PLAN.md](PLAN.md)). The four-browser run on the review fixes is pending (M0).
- **Still proposed:** the WF-05 slice; the WF-06, 07 and 09 additions above; tablet and keyboard coverage; the access-support policy for decoding and spelling (owner decision).
- **Not claimed:** child usability, learning gains, or a "world class" experience. Only M7 and later observation can speak to those.
