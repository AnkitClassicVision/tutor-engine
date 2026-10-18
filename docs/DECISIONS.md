# Tutor Engine v1 decisions

Locked on 2026-10-04 so the site can be built and used. The spec left these open. The request also asked for storage, secure logins, and tracking for each student. That overrides the spec lines that say "no login" and "no multi-kid" for v1.

These are the defaults the app ships with. Propose a change in an issue or pull request if a default is wrong.

| Question | Decision |
| --- | --- |
| What are we building? | A local web app that runs the tutor loop. Laptop browser now. Pi or Jetson later, and only if local models become the real problem. |
| Who logs in? | A parent account, email and password. Each student is a profile on that account. Students do not get passwords in v1. The parent chooses who is at the desk. Camera recognition waits for the later box. |
| Where is data stored? | SQLite at `data/tutor.sqlite` on the machine running the app. Sheet photos stay in `data/uploads/`. The server binds to 127.0.0.1 unless `TUTOR_HOST` is set. |
| Are kid answers sent to a cloud model? | Objective keys are checked locally. By the parent's 2026-10-05 choice, written reasoning is graded automatically by the configured AI using the response and stored key/rubric. Failed or uncertain calls stay pending with a parent-review fallback. Photos remain local. |
| Which standards? | A Common Core math graph, grades 4 through Algebra, checked into `src/data/math-backbone.json`. Titles are short original phrases, not copied standard text. A Georgia Standards pack can replace the file later. The loop does not care which pack is loaded. |
| Which child? | None are hardcoded. The parent adds each student, with a birthday and a session cap. |
| How does grade move? | Birthday, using a September 1 cutoff. The grade updates on that date. The parent can hold a different grade for a skip or a repeat. |
| Where does the content come from? | The math list for the current grade is the standing plan. The parent adds other subjects, school topics, and special cases. An exact practice problem is stored word for word and used the next time that concept comes up. |
| Printer? | Letter-size HTML. The browser prints to PDF. Every sheet has a QR payload (the sheet id), corner marks, and one answer box per item at stored coordinates. |
| Who gets a stuck flag? | The parent, on the weekly scoreboard. A concept is stuck when its last three sessions are each under 70 percent. The flag names the latest error type. |
| Session length? | 25 minutes unless the student profile sets another cap. The session stops at the cap. |
| What is in v1? | Parent login, student profiles, concept graph, dated and standing targets, the six-beat session, hint ladder, thermostat, mastery rule, printed sheets, weekly scoreboard. |
| What is not in v1? | Face or voice recognition, live camera grading, cloud vision, science, screen mini-apps, custom hardware, a hired-tutor workflow. |

## Conflict calls inside the spec

- The session shape asks for 4 to 6 warmup items. The mix rule asks for about 25 percent review. A 12-item session uses 3 review, 7 frontier, and 2 stretch so the 60/25/15 law stays testable. Those 3 review items are the warmup beat.
- Objective keys are scored locally. The parent selected automatic model grading for written reasoning, Analyze explanations, Evaluate, and Create. A structurally valid rubric verdict with confidence at least 0.8 enters mastery and the thermostat; uncertain, malformed, or failed calls stay pending with a parent-review fallback. The same three-success rule applies, with the response's actual Bloom level, hints, and interleaving. The recap is reflection; its checkbox does not award a Bloom success.
- Concepts two or more grades below the student start as mastered at Understand, with a review date a week out. Session zero still probes anything the target actually rests on.
- Days are the server's local calendar dates.

## Course and assessment contract, 2026-10-05

- Planning and curriculum generation receive the same `plan-course` skill, spec Layers 0–7, and the implementation conflict calls before AI provider dispatch. `update-learning-path`, `adapt-session`, and `assess-learning` define the related workflows. Provider credentials do not choose pedagogy.
- A response contains 1–6 topics for the next focused slice. It does not replace the standing backbone. Generated questions carry their actual Bloom level; reasoning and production include a rubric. Malformed curriculum responses are rejected as a whole.
- The existing rolling-six controller adjusts the next unanswered item, including reserved practice. A hold or a correct item breaks consecutive step-downs; modality changes update the next item's surface. Due review checks a mastered rung, and frontier can reach Evaluate (5) and Create (6).
- A short strong assessment does not advance the math course. Automatic course progression requires every tracked backbone concept in that course to be mastered at Analyze or above. Parent placement changes remain available.
- A valid new school overlay reuses matching backbone IDs and keeps learner evidence. Existing unused questions remain available while generation is pending or fails; they are replaced after a valid result returns.
- The next-action view offers practice, a check without a lesson, a dated-test focus, and a different focus. Regular practice can interleave due concepts across subjects; subject assessments retain their selected coverage.
- Decision cards preserve choices, scores, grading reasons, curriculum sources, difficulty adjustments, model changes, and session endings. Records include the active provider/model and spec revision without keys, and the planning stages read the recent history after a provider swap.
- A simple exponential forgetting estimate supports planning; it is a model estimate, not measured retention. Memory misses shorten stability and return work to review. The 7/30-day scoreboard checks the mastered Bloom rung with at most one hint. Evidence is ordered by submission timestamp when available.
