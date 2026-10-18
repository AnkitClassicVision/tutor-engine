# Learning packs: say what you want, get checked practice

Decided with the owner in chat on 2026-10-16. Content used to come from class plans that wrote two questions per topic. A test date generated nothing, so most practice fell back to generic scaffolds. A learning pack turns one request in everyday words into a short lesson and checked practice on exactly what was asked.

## Who asks, and how it is made

- **Child:** the "What do you want to practise?" card on the home screen, with voice typing. The parent decides in Controls → What your child can ask for:
  - Requests: off, only for their classes (the default), or any school subject.
  - What happens next: make it at once (the default), show the plan first, or wait for the parent's OK.
  - A daily limit, 3 by default.
- **Parent:** the Make practice box on the parent page, or the planner (the `make_pack` intent, for example "10 fraction word problems" or "practice for Friday's spelling test"). Each request chooses Make it now (the default) or Show me first.
- **Test dates:** saving a test date in the planner also makes practice on its topics.
- **Make it now:** progress shows in place (Reading your request → Writing → Checking every answer → Ready). The pack then leads the child's next mission and starts with its one-minute lesson.
- **Show me first:**
  - A parent's request is written and checked, then held. The parent sees every question with its answer and presses Use this practice or Set it aside.
  - A child's request shows only the plan (topic, count, subject, test date) with 6, 12 or 18 questions to choose from. Nothing is written until Make it, and the child never sees answer keys.
- **Where requests show up:** child requests appear in the parent's planner thread. Undo on the pack page or the history page removes unused questions, any new topics that have no answers yet, and any test date the pack created. Answers already given stay.

## Pipeline: one durable `pack` job, 2–3 model calls

1. **Brief (code, no model call).** `briefFromWords` reads:
   - the subject, from the child's classes or subject words;
   - the topic, without the polite wrapper, the count or the date;
   - the count (6–18, default 12), split into 1–3 skills of at least 6 questions each, enough to fill a new topic's probe without templates;
   - a test date, via `findDate`;
   - preferred formats ("multiple choice", "explain").

   If no subject is found, it asks back with clickable chips.
2. **Runbook routing.** Each `skills/pack-*/SKILL.md` front matter declares its subjects, keywords, formats, Bloom range and whether math work is required:
   - `pack-math-procedure`
   - `pack-math-word-problems`
   - `pack-vocabulary`
   - `pack-concept-check`, the fallback

   The body says how to balance a skill, write each format and its key, write hints and the lesson, plus good and bad examples. Runbooks ship with Vercel's `skills/**` bundle.
3. **Write (one call).** The runbook, the teaching moves, `assess-learning`, the brief and light learner evidence produce one strict JSON pack:
   - an interpretation sentence;
   - a lesson: hook, steps, worked example and quick check;
   - skills, each item with prompt, answer, format, choices, work, three hints, explanation and Bloom level.
4. **Code gate (`src/pack-qa.ts`), the part that holds for any model:**
   - format and Bloom level inside the runbook;
   - lengths, three distinct hints, and an explanation;
   - safety on every string;
   - math keys recomputed exactly from `work` by a whitelisted rational parser, never `eval`;
   - multiple choice: the key is exactly one of 3–4 distinct options, with no all/none of the above;
   - no hint, and for one-word answers no prompt, contains the answer;
   - written answers carry a `Rubric:`;
   - no repeats of anything the learner has seen;
   - an 8-word copy check against sources;
   - a readability warning, and a block when the text reads far above the grade.
5. **Independent check (one call).** The model answers every question without the keys and rates its topic and grade fit. A question is flagged if code marking disagrees with its key, if either rating is 2 or below, or if a real issue is named.
6. **Repair (at most one call).** Only the flagged questions are rewritten, and the rewrites must pass the code gate again.
7. **Publish.** A skill needs at least 4 passing questions. Questions are stored with `pack_id`, format, options, hints and explanation. A pack-only topic (`purpose 'special'`) does not join the standing course. A test date becomes a target. A `pack_published` decision is recorded for undo.

Each stage's output is saved on the `packs` row, so a job resumed after a Vercel timeout or a lost lease skips the stages already done. The parent card says "checked twice" only when the independent check actually ran.

## Serving and marking

- `claimPractice` serves pack questions first, then the one closest to the slot's demand. Questions already seen are skipped, and pack hints, options and explanations are copied into the session.
- Difficulty changes swap in a pack question at the new demand before falling back to a template.
- Rebuilding a class keeps pack questions.
- Marking follows the format: multiple choice by letter or option text, one-word answers case-insensitively, numbers including fractions, mixed numbers, percentages and units. Written answers keep rubric grading.
- Multiple choice is answered with large options in the session. A miss shows the item's own explanation.

## Limits and safety

- One pack is made at a time per child. A repeated request id returns the same pack.
- Requests are capped at 300 characters for a child and 600 for a parent. Daily limits: the child's setting (3 by default), and 10 for a parent.
- Unsafe text is answered at once by the child-safety tripwire and stored nowhere.
- Requests are passed to the model as quoted data. The child-safety brief precedes every call.
- Students may POST only `/students/:own/packs`. On pack routes they may read `''` and `/lesson`, and use `/make`, `/start` and `/discard` (a plan only). Publish, undo and settings are parent-only.

## Measuring quality across models

- `eval/packs/defects.jsonl` holds 58 deliberately broken questions across the four runbooks, plus 7 good controls. CI requires the code gate to catch every defect and pass every control (`test/pack.test.ts`).
- A real-model run on 2026-10-16 (local Codex, synthetic learners) produced:
  - fractions for a dated quiz: 10 questions, 8 keys recomputed;
  - weather vocabulary: 12;
  - the water cycle: 12;
  - multiplication word problems: 18.

  Every question passed both checks, and each pack took 31–55 s. The questions were read by hand.
- Next (phase 3): a request set per runbook with gold keys, `scripts/evaluate-packs.ts` per provider and model, and a runtime gate that defaults an unqualified model to Show me first.

## Phase 2 (not built yet)

Day-by-day test plans (`pack_days`), a printable sheet with a parent-only answer key, and active packs on the This week zone.
