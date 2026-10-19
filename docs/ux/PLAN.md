# Delivery plan and decision log

Round 1 (steps 0–10 below) implemented the audit's first batch. Round 2 runs the package itself, one prompt at a time from [AGENT-PROMPTS.md](AGENT-PROMPTS.md), following the [process series](PROCESS-SERIES.md). Each milestone ends with its output committed, its criteria checked against evidence, and a receipt on the project board before the next prompt starts.

## Round 2: prompt by prompt

| Milestone | Prompt | Process steps | Output | Done when |
|---|---|---|---|---|
| M0 | Round 1 close-out (suite green 188/188; release decision pending) | UX-10 | Green full browser suite on the round 1 fixes, then the owner's release decision | All four browsers pass; migration 022 applies on Postgres at deploy; deploy and publish happen only with the owner's yes |
| M1 | 1. Orchestrator | UX-01 | [ORCHESTRATION.md](ORCHESTRATION.md): current-state re-audit, WF-01–09 coverage matrix, decision log, the next slice with file ownership | Every WF-xx-A row has evidence (code, test or run) or says UNKNOWN; one next slice is named with its acceptance IDs |
| M2 | 2. Researcher | UX-02 (plan only) | [RESEARCH.md](RESEARCH.md): evidence table for the open questions (access support versus decoding and spelling, early-reader one decision at a time, healthy finishing, children's understanding of AI), plus the next study | Every material claim cites a primary source with date, participants and limits; adult-to-child transfer is flagged; nothing claims research ran |
| M3 | 3. Flow architect | UX-03, UX-04 | `flows/` contracts for WF-05, WF-06, WF-07 and WF-09 (not yet audited), and current-behaviour notes for the rest | Each has trigger to exit, the formal states, failure recovery, current versus proposed, any engine-rule diff named explicitly, and linked acceptance cases |
| M4 | 4. Interaction and visual designer | UX-05, UX-06, UX-07 | `design/` for the chosen slice: labelled synthetic mock pages for phone, tablet and laptop and each age band, with states, microcopy and an accessibility checklist | Ready, loading, supported, independent, pending, error, disputed, saved and completion states shown where relevant; keyboard order, 44/64 px targets, reduced motion and non-colour cues specified |
| M5 | 5. Implementer | UX-09 | Code and tests for the M3/M4 slice | Its acceptance IDs pass in unit and four-browser tests; no scoring or engine-rule change without the owner's recorded decision |
| M6 | 6. Independent QA judge | UX-10 | [QA-ROUND-2.md](QA-ROUND-2.md): PASS/FAIL/UNKNOWN per acceptance, defects and the release judge's decision | Run by a reviewer who did not write the code; every critical defect fixed or explicitly held |
| M7 | Family sessions and pilot | UX-08, UX-11, UX-12 | Aggregate, de-identified findings from [FAMILY-SESSION-KIT.md](FAMILY-SESSION-KIT.md) sessions and a dated 7/28-day follow-up list | Run by the parent with their own children; only matured outcomes are reported; untested ages and devices stay UNKNOWN |

Rules for every milestone: the shared assignment contract in AGENT-PROMPTS.md applies; synthetic data only; nothing is sent, published or deployed without the owner's yes in chat; a self-review is not independent QA.

## Round 3

| Card | Step | Output | Done when |
|---|---|---|---|
| R3-1 | Orchestrator | [ORCHESTRATION-R3.md](ORCHESTRATION-R3.md) | Each chosen item has acceptance cases, evidence or UNKNOWN, and its files |
| R3-2 | Flow and designer | `flows/WF-01.md`, `design/wf01-states.html` | Every AI state has trigger, what works, wording, recovery and exit; screenshots pass the overflow and target check |
| R3-3 | Implementer | AI connection states on every screen | Each state shows the right wording and action on the child, parent, controls and photo pages; unit, HTTP and four-browser tests |
| R3-4 | Implementer | Shared-device safety and stale planner suggestions | WF-09-A cases 4 and 5, WF-07-A cases 2 and 5 pass |
| R3-5 | Coverage | Tablet project, keyboard mission, simultaneous confirm, hosted adaptive spec | Green, or real defects fixed or recorded |
| R3-6 | Independent QA judge | [QA-ROUND-3.md](QA-ROUND-3.md) | Reviewer did not write the code; judge decision recorded |

## Round 1

Status: in progress, started 2026-10-19. One step at a time; each step uses the matching prompt in [AGENT-PROMPTS.md](AGENT-PROMPTS.md), names its workflow and acceptance IDs, and ends with tests and a commit before the next step starts. Code tests are recorded as code tests; nothing here is child usability or learning evidence.

| Step | Slice | Source | Workflow / acceptance | Status |
|---|---|---|---|---|
| 0 | Bring this package into the private source so the public export keeps it | PR #1 | — | Done |
| 1 | Honest evidence labels: no Cohen's h to 2-sigma equivalence, thinking demand is not difficulty, one feature compared at a time | Audit 1, card 1 | WF-07-A | Done: wording, one comparison at a time, tests (code only) |
| 2 | Coaching drafts kept until the server saves them, per learner | Audit 6, card 2 | WF-08-A | Done: failed send, reload, repeated send; four browsers (code only) |
| 3 | Read-aloud separate from reduced motion, stored per learner | Audit 4, card 3 | WF-02-A | Done: per-learner choice, reading independent of motion; four browsers (code only) |
| 4 | One truthful AI capability state for setup, child home and parent tools | Audit 3, card 4 | WF-01-A, WF-02-A | Done for no connection; other failure states still open (see log) |
| 5 | Child can say "I think there's a mistake"; the parent decides | Audit 7 | WF-04-A | Done: one concern per answer, parent decides; four browsers (code only) |
| 6 | Early-reader journey (question, hint, correction) and a clear Done for today | Audit 2 and 9, card 6 | WF-03-A, WF-04-A | Done: finish order, hearable feedback and hints, photo defaults (code only) |
| 7 | Record access support separately from teaching help, without changing scoring | Audit 5 | WF-03-A | Done: recorded, scoring unchanged (code only); policy decision open |
| 8 | Time what the learner sees: question visible, feedback visible, paused time kept apart | Audit 10 | — | Done: on-screen times, original start and pause total kept (code only) |
| 9 | Family session kit for observing our own children (cards 5 and 7) | Audit 8, UX-02, UX-08 | Scorecard panels 1, 3, 5 | Done: [FAMILY-SESSION-KIT.md](FAMILY-SESSION-KIT.md); sessions not yet run |
| 10 | Independent QA judge over steps 1–8, then release | Scorecard release judge | All above | Planned |

## Decisions

- 2026-10-19: Owner asked to use the PR #1 package and execute it one step at a time until complete. Order follows the package's first batch (evidence wording, drafts, preferences, connection state) and then the remaining audit findings. Scoring rules are not changed by any step; step 7 records support only.
- 2026-10-19, step 1: The parent view describes the before/after change without implying cause, says Cohen's h is not on Bloom's 2-sigma scale, and calls a rise in thinking level a different kind of question, not a harder one. A second week-on/week-off comparison is refused while one runs (existing enrolments in both show a combined-effect note). The gain calculation is unchanged.
- 2026-10-19, step 2: Questions typed to the tutor (after a mission, at a checkpoint, and on homework help) stay in the browser until the page shows them as sent; they are no longer cleared on submit. Each typed question carries one send identifier, and the server reuses the first job for a repeated send, so a retry after a lost reply adds the message once. Drafts are keyed to the session or homework question path, so a sibling's page never shows them. Not covered: two different tabs sending the same draft at the same instant.
- 2026-10-19, step 3: Reduced motion no longer turns off reading questions aloud for ages 5–7; motion still only affects animation. The Read questions to me choice is stored per learner on the device, so a sibling keeps their own. Earlier device-wide choices are not carried over, so reading starts on again for each child. Tested: reduced motion with reading on, reading turned off and remembered, and a sibling starting with reading on.
- 2026-10-19, step 4: Testing the promise found it false. With no AI, a written answer started a grading job that could only fail, leaving the child on a "Could not finish" page. Now a written answer is saved for a grown-up to check and the child carries on (short answers were already checked on the site, and hints come from the stored ladder). The setup page, child home, parent banner, parent overview and controls all use one statement (`WITHOUT_AI` in `src/services.ts`). A browser test signs in as a family with no AI and answers a whole mission on four browsers. Still open: revoked access, used-up plan and photo-model-missing states are reported only when a job runs, not on these screens.
- 2026-10-19, step 5: A missed answer's feedback card offers "I think there's a mistake". It records one concern per answer (migration 022, `session_items.concern`), however many taps, and the child sees that a grown-up will look. The grade counts as it stands until the parent decides, so a child cannot remove a miss by tapping. The parent sees the question, the child's answer, the tutor's answer and verdict on the grading page and in the overview banner. "The grade is wrong" uses the existing dispute rule (stays on record, counts neither way); "Keep the grade" closes it. A decided concern cannot be raised again. Shown only on misses.
- 2026-10-19, step 6: A finished mission now leads with "Done for today" (primary). One optional next step sits beside it, and the other paths are behind "Other things to do". Done returns home with "All done for today. Your work is saved." For ages 5–7, a miss shows one short line, a hint and the checkpoint nudge each have a Hear this button, and the talk-through text is one sentence. On the photo page, the name, subject, kind and work state get defaults and are tucked under "About this page (a grown-up can change this)". Scoring is unchanged. Found while testing: when a connected AI fails to grade a written answer, the child still lands on a "Could not finish" job page, with a link back to their saved work. That belongs to the step 8 and QA review.
- 2026-10-19, step 7: The question read aloud (by a tap, or automatically for ages 5–7) and an answer spoken into the microphone are recorded as `access_support` on that question (migration 022, now `022-ux-workflows.sql`, holding both new columns). Attempt records carry them as `accessSupport`, separate from `supportUsed` (hints, homework). Scoring, independence and mastery are unchanged. Open decision for the owner and learning lead: whether any task type (for example a decoding or spelling check) should treat read-aloud or voice entry as changing what it measures. Until then, nothing reclassifies an attempt.
- 2026-10-19, step 8: The browser notes when a question (`visible_at`) and its feedback (`feedback_visible_at`) are first actually on screen, waiting until the tab is visible. A mission keeps its original request time (`requested_at`) and the total time paused (`paused_ms`). `started_at` still moves forward on resume, so the time cap stays honest. The time-to-first-question measure uses the on-screen time where it exists and the server page time for older missions. No answer text is in any timing record. All four columns are in migration 022. Not done: an aggregate p95 report on real devices.
- 2026-10-19, step 10 (independent review): verdict REVISE. Fixed:
  - D1: written answers saved without an AI now appear on the grading page under "waiting for you", with It meets it / Not yet, and the parent banner links there.
  - D2: with no AI, the talk-through forms are replaced by one plain line. Starting a topic that needs newly written questions explains that instead of starting a job that cannot finish.
  - D3: only a miss can be questioned.
  - D4: time to first question counts from the original start, and its definition says a pause before the first question counts.
  - The concern buttons now have distinct names for screen readers.
  - A repeated `/ask` send is now covered by an HTTP test.

  Accepted as known limits:
  - D5: two simultaneous sends of the same homework-help draft can still save the message twice.
  - D6: a message cut down by the server before display leaves its draft in place.
  - D7: the read-aloud and voice-entry policy for reading and spelling subjects is an open owner decision.

  Still to do: migration 022 has not yet run on Postgres; the deploy check covers it.
- 2026-10-19, M1 (prompt 1, Orchestrator): [ORCHESTRATION.md](ORCHESTRATION.md). Of the nine workflow acceptance checks, eight are partial, one has a gap (WF-05, no confirm-before-help step) and none fully pass. Next slice chosen: WF-05, confirm the homework question before help. M3 also writes contracts for WF-06, 07 and 09.
- 2026-10-19, M2 (prompt 2, Researcher): [RESEARCH.md](RESEARCH.md). Nine sources across five questions, with limits and adult-to-child flags; one source cited but unread (4b). Proposed an access-support rule by measured skill (reading, decoding and spelling versus maths) for the owner's decision; nothing applied. Added C9 ("What is the tutor? Can it be wrong?") to the next study.
- 2026-10-19, M3 (prompt 3, Flow architect): [flows/](flows/README.md). WF-05 has a full confirm-before-help contract: six states, ten acceptance cases and three proposed columns. WF-06, 07 and 09 have current-versus-proposed contracts with test additions. One wording-only proposal (WF-06: show the demand of a lower-level retention success) needs the owner's decision. No engine rules are changed.
- 2026-10-19, M4 (prompt 4, Designer): [design/](design/README.md). Compared three options and chose one confirm screen per question. Labelled mockups for all WF-05 states and the 5–7 variant, screenshotted at 390, 820 and 1280 px, with an automated check for overflow and 44/64 px targets (one stacking bug found and fixed). Includes microcopy, keyboard order and the M5 handoff. Not yet tested with children.
- 2026-10-19, M0: full four-browser suite 188/188 on the round 1 fixes. The release (deploy, publish, close PR #1) waits on the owner's yes.
- 2026-10-19, M5 (prompt 5, Implementer), commit fb28052. WF-05 is built:
  - Help starts only after the child taps "Yes, help me", fixes the text, or types an unreadable question.
  - The fix is stored and sealed beside the original reading, which is never overwritten.
  - The parent sees "Checked by" or "Fixed by" and can see the original reading.
  - A new reading of the page asks the child again.
  - Ages 5–7 get "Is this it?" with Hear this and one decision.
  - Storage: three columns added to the unreleased migration 022.
  - Tests: an HTTP acceptance test covers cases 1–7 and 10; the homework browser flow passed 36/36 across four browsers; unit tests passed 356/356.
  - Not covered by a browser test: the fix path and the low-confidence warning (both are covered by the HTTP test).
- 2026-10-19, M6 (prompt 6, independent QA judge): [QA-ROUND-2.md](QA-ROUND-2.md). Three passes: REVISE, then REVISE (narrow), then LIMITED PILOT for WF-05 within our own family once the owner says yes. Every defect found was fixed, apart from the accepted limits listed there. Full four-browser suite 196/196 at 7c8b7f8; affected specs 56/56 and 20/20 after the last fixes.
- 2026-10-19, release: the owner approved in chat ("yes approced"). Rounds 1 and 2 deployed (kids-tutor-idn75n7ji, migrations 1–22), published (public a9bd27a), and PR #1 closed as incorporated. M0–M6 accepted.
- 2026-10-19, M8 (owner policy decisions, "yes it should"):
  - A question read aloud makes a reading-subject check supported, and a spoken answer makes a spelling check supported. Maths is unchanged.
  - Reading subjects are not auto-read for ages 5–7.
  - The ladder labels a memory step shown at a lower level.
  - Scope and implementation: `src/engine/access.ts`; no historical reclassification.
- 2026-10-19, M8 review: independent QA REVISE (narrow), then LIMITED PILOT once the owner says yes. Fixes: the rule uses each question's own subject (reviews from other subjects inside a mission); read-aloud help counts as supported on the strengths map and the overview. Accepted lows: the answer-time log does not write "access"; a late read-aloud note is dropped. Unit 360/360; affected four-browser specs 32/32. Commit 09a6a0c, not yet deployed or pushed.
- 2026-10-19, round 3 started (owner: "yes start round 3"). R3-1 done: [ORCHESTRATION-R3.md](ORCHESTRATION-R3.md). Main slice: AI connection states (WF-01). Then shared-device safety, stale planner suggestions, apply-twice test and coverage.
- 2026-10-19, R3-2 (prompts 3–4): [flows/WF-01.md](flows/WF-01.md) and [design/wf01-states.html](design/wf01-states.html). Seven states, each with what still works, wording, action and how it clears; seven acceptance cases. Screenshots at three widths pass. Ages 5–7 get a one-sentence child banner.
- 2026-10-19, R3-3: WF-01 AI connection states built (330abd5): classified failures, per-family state (migration 023), shown on every screen, cleared by a working call or new settings. Unit 364/364, cloud 3/3, affected four-browser specs 84/84.
- 2026-10-19, R3-4: a stale planner suggestion is refused with an explanation (72574c7; unit test). Signing out clears unsent drafts in the tab, and Back after sign-out shows no family page (new shared-device spec, 4/4 browsers; it fails without the fix). Apply-twice was already tested (`test/planner.test.ts:67`), so the orchestration record is corrected.
- 2026-10-19, R3-5 coverage:
  - Added an iPad-sized tablet project (WebKit, touch) running the child-journey specs.
  - Added a keyboard-only mission test on Chrome, Firefox and mobile Chrome. It is skipped on desktop Safari, which by default tabs only to form fields.
  - Added a simultaneous-confirm test (one confirmation from four at once) and WF-06 ladder cases 1 and 3.
  - Updated the hosted adaptive spec to the current screens; it passes against the live site.
  - Results: full suite 226 passed, 1 skipped (22.1 min); unit 367/367.
- 2026-10-19, R3-6 (independent QA judge): [QA-ROUND-3.md](QA-ROUND-3.md). Pass 1 REVISE (high: a ChatGPT 401 locked families out). Pass 2 LIMITED PILOT for WF-01, WF-07, WF-09 and coverage. All findings fixed (6f6b390, 5d74452). Full five-project browser suite 231 passed, 1 skipped; unit 368/368; cloud 3/3 through migration 023. Release waits on the owner's yes (deploy applies migration 023).
