# Orchestration: round 3

Prompt: [AGENT-PROMPTS.md](AGENT-PROMPTS.md) §1, Orchestrator. Snapshot: private main `a2721bb`, 2026-10-19, after rounds 1–2 and the access-support policy went live. It builds on [ORCHESTRATION.md](ORCHESTRATION.md); evidence is code and tests only.

## Chosen for round 3

| Item | Acceptance | Current evidence | Planned change | Files it may touch |
|---|---|---|---|---|
| **A. AI connection states** (main slice) | WF-01-A: revoked access, used-up plan, unavailable photo model "each lead to a usable action" | **GAP.** `aiConnectionProblem` (`src/services.ts`) checks configuration only. Provider failures arrive as generic errors (`src/ai.ts` "rejected the key or the model name"). The ChatGPT kinds (`limit`, `not_eligible`, `reconnect`) appear only on the failed job page (`src/jobs.ts`). The photo model is used blank when unset (`src/schoolwork.ts`). | Classify provider failures, record the family's AI health, show one state on every screen, and clear it on a working call or a new connection. The photo page tells the truth about photo reading. | `src/ai.ts`, `src/services.ts` (settings, `WITHOUT_AI`), `src/jobs.ts`, `src/journey-view.ts`, `src/server.ts`, `src/view.ts`, migration 023, tests |
| **B. Back button after logout** | WF-09-A case 4 | **UNKNOWN.** Every HTML page is sent with `Cache-Control: no-store` (`src/server.ts` `send`), which normally keeps a page out of the back/forward cache. Untested. | A browser test first; fix only if it fails. | `test/browser/`, `src/server.ts` only if needed |
| **C. Drafts when the device changes hands** | WF-09-A case 5 | **PARTIAL.** Drafts are kept per page path in session storage (round 1, step 2), so siblings never see each other's, but they stay in the tab after logout. | Clear session-storage drafts on logout and on locking to student mode for another child. | `public/journey.js`, tests |
| **D. Stale planner suggestion** | WF-07-A case 5 | **GAP.** A new suggestion replaces older ones (`setPlannerStatus` superseded), but a suggestion made before another change was applied can still be applied. | Refuse Apply when a different planner change was applied after the suggestion was made, explain why, and offer a fresh suggestion. | `src/planner.ts`, `src/planner-view.ts` or the drawer copy, tests |
| **E. Apply twice** | WF-07-A case 2 | **Correction (R3-4):** already tested. `test/planner.test.ts:67` applies twice and checks "Already applied". The original ORCHESTRATION.md row was wrong. | None needed. | — |
| **F. Coverage** | WF-02-A tablet and keyboard; WF-05-A case 5 | **UNKNOWN.** No tablet project; no keyboard-only mission; simultaneous confirms untested. The hosted adaptive spec fails on its stale "Choose your path" heading. | Add a tablet Playwright project, a keyboard-only mission test and a simultaneous-confirm test; update the hosted adaptive spec. | `playwright.config.ts`, `test/`, `test/hosted/adaptive.spec.ts` |

## Not taken this round

| Item | Reason |
|---|---|
| WF-06 ladder test additions (cases 1, 3, 5) | Case 5 was covered by the owner's ladder wording change; cases 1 and 3 are small tests and are added under F. |
| WF-08 offline after receipt; retry after restart | Needs a service-worker design; out of scope for server-rendered pages without a decision. |
| Speech-recognition errors (WF-04) | The simulated microphone cannot inject wrong words; needs a fixture change. Next round. |
| Child usability | Only the family sessions (M7) can provide it. |

## Order

R3-2 (WF-01 contract and screens), then R3-3 (build A), then R3-4 (B–E), then R3-5 (F), then R3-6 (independent QA), then the owner's release decision.
