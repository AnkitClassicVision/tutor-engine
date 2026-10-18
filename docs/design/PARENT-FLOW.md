# Parent flow: one conversation, one dashboard

Decided with the owner in chat on 2026-10-15. Parents used to act through about twelve feature-organised surfaces; only "Plan a class" was a conversation, and every change to something that existed was a different form. The redesign gives parents one conversation and one dashboard per child.

## The planner drawer

A planner conversation is available on every parent page (parent area, history, scoreboard, schoolwork, live tutor, strengths map, family progress, AI settings). On desktop it is a non-modal side panel; on phones it is a modal bottom sheet. It is scoped to the child on the page and is rendered only for an unlocked parent session, never for a student-only session and never on learner, job or print pages.

Parents write in their own words or use voice typing. The planner answers with a card describing exactly what would change, and nothing changes until the parent presses Apply. Replies arrive in place with the inline thinking companion; the page never switches to a job screen.

### Bounded intents

The model fills in parameters but can only choose from this list; everything else is answered as `unknown` with the menu of things it can do:

| Intent | Parameters | Apply calls |
| --- | --- | --- |
| `add_class` | subject, about | existing class-planning turn mirrored into the Plan a class thread, then `acceptPlan` + `startCurriculumJob` |
| `change_class` | subject (existing), focus | `addDirection` (parent note) + rebuild through the same path |
| `set_test` | title, date, topics | `createTarget`, dates before today refused |
| `add_homework` | subject, text | photos are attached in the drawer instead (see below); typed homework points to the Schoolwork page |
| `set_minutes_presentation` | minutes 3–25, presentation auto/junior/explorer | `setPresentation` |
| `set_grade_birthday` | birthDate, grade, gradeHold | `updateStudentProfile` |
| `parent_note` | text ≤200 chars | `leaveNote` (one unread note at a time) |
| `ai_setup_help`, `question` | none | answered from the supplied context, no write |

Validation mirrors the existing forms (`validateProposal` in `src/planner.ts`). Only one proposal per child is open at a time; a newer proposal supersedes the older one, and applying is idempotent. Every applied change records a `planner_change_applied` decision carrying the ids and before-state needed for undo.

Without an AI connection the planner still works for the simple intents through a rule-based fallback and answers questions from the weekly numbers; with one, a `planner` job makes one classification call and, for class intents, one class-planning call.

### Contract

- `GET /students/:id/planner` → HTML fragment (thread, proposal cards, form, prompt chips).
- `POST /students/:id/planner/message {message}` → `202 {jobId, location, messageId}` when a job runs, `200 {reply, proposal, ai}` when answered at once, `409` while a previous message is pending.
- `POST /students/:id/planner/apply/:proposalId` → `200 {applied, decisionId, jobId?, location, message}`; `404` unknown; `409` replaced.
- `POST /students/:id/planner/decline/:proposalId` → `200`.
- `POST /students/:id/note {text}` (parent) and `POST /students/:id/note/read {id}` (allowed for the child).
- Storage: `planner_messages` (per child, typed proposal and status), `parent_notes`, `digests` (migration 007).

## The three-zone parent home

1. **This week**: two or three plain sentences from the last seven days (`src/week-summary.ts`, no model call), one suggested action that opens the planner pre-filled, the four counts (checks done alone, learning days, reviews due, awaiting review), and the two evidence lists.
2. **The plan**: the class cards with a labelled next focus, the guided Add a class card, the planner stepper, and the school-result form. "Change this class" pre-fills the drawer; the Plan a class tab remains the no-script path.
3. **Controls**: student sign-in, time and presentation, AI connection, export, history, live tutor and deletion, in a collapsible section.

Vocabulary: agenda → next focus; targets → a test coming up; supported vs independent → right with help vs checks done alone.

## Motion

Tokens live in `public/app.css` (`--t-fast`, `--t-base`, `--t-slow`, `--ease-out`, `--ease-pop`, `--stagger`, z-index scale). The drawer slides, bubbles arrive with a small rise, the applied card shows one keepsake star, and the thinking companion floats inline. Every state is a class or attribute, so the global reduced-motion rule makes everything instant without breaking it.

## Undo

Undoable: planner changes, test dates, practice minutes and presentation, birthday and grade, math course and subjects, unread notes to the child, and notes to the planner. Each records its before-state. Undo restores it only while the child's current state still matches the change, so an older change cannot overwrite a newer one; the history page shows "Changed again later" instead. A class built from the planner is removed with its new topics, its build job is cancelled, and the plan returns to its earlier summary, until the child has practised one of those topics. Questions already written for existing topics, removed topics, answers, grading and school results are not undoable. Every undo records `change_undone`.

## Sunday digest

From Sunday 12:00 UTC one job per family composes two to three plain sentences per child (no model call), any keepsakes earned, the next dated test, the next mission and one suggestion, plus a link to each parent area. It is saved in `digests` (read at `/family/digests`, linked from This week while unread) and queued once in the mail outbox with a fixed id, so retries and the Monday to Wednesday catch-up never send twice. Vercel Cron triggers `/cron/weekly-digest` with the project `CRON_SECRET`; request traffic and the local worker are fallbacks.

## Photos in the planner

Parents attach up to twelve JPEG or PNG pages in the drawer (camera or library). The browser shrinks each to at most 1800 px, shows removable previews, and uploads them straight to private storage on Vercel (upload token, private Blob put, completion check) or inline when running locally. The server files the batch from the parent's words without a model call: "marked" or "score" becomes marked work, "test", "quiz" or "study guide" becomes a practice test (with a dated test when a date is given), and anything else becomes homework. The pages are saved as schoolwork and appear as thumbnails in the conversation with a link to the saved pages. For homework and practice tests the planner proposes "Use for practice" or "Prepare for this test"; Apply asks the existing school-path job to read the pages and build practice. A retried send reuses the same request id, so the pages and the conversation entry are saved once. Using pages for practice is not undoable from the card; the pages' own page offers "stop using these pages".

## The Plan a class tab is retired

The parent page now has two tabs, Classes and Student details. The Add a class card, "Change this class", "Choose something else" and the This week suggestion all open the planner pre-filled. Older links with `?talk=<class>` (job results, emails, bookmarks) open the planner with that class named, and `?planner=open&say=…` links work without scripts because the server renders the drawer already open. The `/talk` and `/build` routes stay for compatibility, and the planner keeps mirroring class conversations into the class thread that `acceptPlan` reads.
