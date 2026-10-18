# Dynamic learning workflow

User direction recorded October 5, 2026. This describes the intended product and distinguishes existing behavior from additions still to implement. It supplements the original Tutor Engine spec; it does not claim the additions are live.

## The student experience

1. Add current school material, or use the material already on the course.
2. Choose a goal: practice next, help with homework, prepare for a test, check without a lesson, or explore a topic.
3. Choose today's available time: 3, 5, 10, 15, 20, or 25 minutes. No block exceeds 25 minutes.
4. See one small mission and a brief reason: what to work on now and why.
5. Work through one manageable step at a time. Support responds to the answer; future questions respond to confirmed evidence.
6. Finish with what the work demonstrated, what remains uncertain, and the next action. Resume later without losing history.

Short blocks need smaller missions, not rushed long worksheets. Evidence accumulates across blocks; a three-minute block need not contain six answers. Do not force a difficulty change without enough comparable scored evidence. Save partial work as unfinished, not incorrect, when time runs out. Breaks and a further block are explicit choices, rather than automatically extending the current block.

## Skill responsibilities

All stages use the same course contract, saved learner state, and relevant decision history regardless of provider. The engine validates outputs and owns timing, scheduling, scoring records, and mastery.

| Stage | Reads | Produces | Current status |
| --- | --- | --- | --- |
| Read school material | Original source, subject, source date, diagrams, any teacher marks | Extracted content with source/page references and uncertainty flags | Text/PDF planning exists; photo/diagram interpretation needs implementation |
| Plan the course | Spec, standing course, school scope, targets, demonstrated strengths/gaps | Concept-level goals and a focused next slice | `plan-course`, `plan-class`, and `plan-from-uploads` are built in |
| Update the path | New material plus prior path/evidence | Changed priorities and future work, with reasons; existing scores preserved | `update-learning-path` is built in; richer image and school-result mapping are additions |
| Design questions | Target concept, source format, Bloom demand, prior questions | Original aligned questions, separate keys/rubrics, required figures | `design-questions` and `assess-learning` are built in |
| Adapt the session | Confirmed answers, hints, errors, timing, due review, current goal | Next task/support/difficulty and next-session priorities | `adapt-session` is built in; per-session time selection is an addition |
| Assess and revise | Fresh answers, rubric verdicts, previous comparable checks | Evidence of progress, gaps, and next agenda | `assess-learning` and `revise-agenda` are built in |
| Review school homework | Uploaded assignment, student work, any teacher rubric/marks, and recorded help | Question-by-question provisional grading, explanations, targeted lessons, and follow-up missions | New upload/review flow to implement using the existing assessment, adaptation, and path-update skills |
| Reconcile school results | Uploaded returned test, entered score, possible teacher marks | External outcome evidence and concept-specific follow-up | New stage to implement |
| Summarize the learner profile | Comparable checks, delayed retrieval, support history | Measured strengths, uncertain areas, and observed response to teaching approaches | New stage to implement |
| Preserve decisions | Choices, evidence, changes, sources, provider/model | Durable history explaining what happened and why | `record-learning-decisions` is built in |

These are workflow responsibilities, not a requirement to expose a button for every stage or install separate skills for each AI provider. Existing skills should be extended where the responsibility already fits; new stages need explicit input/output contracts.

## School material drives relevance

Accept syllabi, teacher agendas, textbook pages, homework, practice exams, and returned tests. Preserve originals separately from extracted text. Interpret diagrams and teacher marks as well as wording; uncertain handwriting or missing pages remain unresolved until confirmed. A failed extraction must leave the existing path usable.

Map material to existing concepts before adding new concepts. Preserve its methods, terminology, question formats, and actual figures where relevant. Generate original practice on the same demands. Keep familiar-format preparation and fresh-context transfer checks distinct so successful imitation does not inflate transferable mastery.

Homework can lead today's work; a dated test changes urgency; a syllabus sets longer coverage. Keep failed foundations and spaced review visible. After a test date, fold those concepts back into the standing path.

## Upload and review school homework

Offer an explicit school-homework upload alongside tutor-created assignments. Let the student take pictures with their device's existing camera or choose existing photos/PDFs; reuse the app's photo-upload foundation rather than requiring another camera app. Provide preview, retake, add-page, and page-order controls. Keep original photos and question numbers so explanations refer to the actual assignment. An optional rubric, answer key, or teacher-marked copy can accompany the work.

Integrate “Help me work through this” into the normal learning journey. A blank question can become the next guided mission; a completed question starts with review; a partial attempt resumes from the last visible step. Use confirmed results to recommend a short lesson or parallel practice automatically, with a clear reason. The student can continue, skip the lesson and take a check, or choose another task. They should not have to create a separate course or manually rebuild the path after each upload. If extraction or topic mapping is unresolved, ask for the missing information and preserve the current usable path.

1. Extract each question, its figures, the student's answer, and visible working. Link the extracted content to the original page or photo. Ask for clarification on unreadable material; do not mark unreadable or missing work incorrect.
2. Grade readable completed work against the actual question and supplied rubric, independently checking the answer when no key is supplied. Use the selected AI for substantive judgment under the shared assessment contract. Flag ambiguous questions and unreliable judgments as unresolved. Label tutor grades separately from recorded teacher grades; do not silently override teacher marks or invent the teacher's point scheme.
3. Show a question-by-question review: what held, where the answer or method broke down, and a short explanation of the concept and correction. Offer deeper explanation for any question, including correct answers. Distinguish what the visible work demonstrates from an inferred error cause.
4. Offer a short lesson on a demonstrated gap, followed by a parallel question the student solves. Guided help begins with a nudge and increases support as needed. Record that help; a corrected original answer remains separate from the original submission.
5. Update the learning path from supported concept evidence. Probe a possible missing foundation before assuming it is the cause. Prioritize a few manageable follow-up missions over the coming week, within the chosen session budgets, school deadlines, and other due work.
6. Include brief spaced retrieval of previously strong concepts. Reduce repetitive practice where strength is demonstrated, while retaining delayed checks. Recheck repaired gaps using fresh unaided questions and later retrieval.

Homework performance informs planning, but outside assistance may be unknown. Preserve that uncertainty instead of treating every correct uploaded answer as independently demonstrated mastery. The tutor's guided corrections do not count as fresh assessment successes.

The saved record includes the original upload, extracted question/response, question-to-concept mapping, grader/provider, verdict and explanation, unresolved issues, visible evidence, known assistance, subsequent lesson and attempts, and the resulting path changes with reasons. Preserve both the original response and later corrections.

## Feedback means outcomes

Do not add thumbs-up/down ratings to this learning loop. Use confirmed answers, hints, error patterns, delayed checks, and external school results as feedback.

Allow the family to enter a score with its denominator, date, subject, and test name, and attach the actual test and marked answers. Record whether the score was entered by a parent/student, read from a document, or confirmed by teacher marks. A total score alone cannot identify which concept was missed. An unmarked test reveals coverage but does not demonstrate the student's performance.

Separate school outcome trends from internal mastery. Compare like coverage and demand where possible; changes in test difficulty or marking schemes must remain visible. Use concept evidence to choose the next questions. A missed school-test item can trigger a prerequisite probe; success on its coached practice version is not evidence that the gap is fixed. Check again with a fresh unaided item and later retrieval.

## Learner profile and radar chart

Use a radar (star/spider) chart as a view of observed work, scoped to a subject and time period. Suggested dimensions are recall, explanation, independent application, analysis/evaluation, creation, and delayed retention. Show transfer to a new setting alongside the chart as a separate measure.

Every dimension needs explicit scoring criteria, the tested difficulty/Bloom demand, the evidence count, and the last observation date. An untested dimension is unknown, not zero. Do not manufacture percentages from a single response. Provide the supporting examples and a simple table so the chart does not hide its evidence.

Keep teaching observations separate from performance: for example, “worked examples followed by explain-back were followed by stronger fresh answers on fractions.” Compare approaches on similar demands and check retention before making a strong recommendation. Speed alone is not success; time and support needed matter alongside correctness and reasoning. Student choices can be recorded without counting them as proof that a method improves learning.

This profile describes changeable performance and observed responses to instruction. It does not assign a fixed learning type or provide a psychological diagnosis. Its purpose is to allocate support and challenge: less repetitive work on demonstrated strengths, more targeted work on measured gaps, and continued retrieval for both.

## Durable history

Preserve original material, extracted versions, answers, scores, teacher marks, hints, timestamps, targets, time budgets, unfinished work, and path versions. Each decision links to its supporting evidence and records the reason plus relevant provider/model context, without credentials. Corrections are new records that explain what changed, not silent overwrites of prior evidence.

Switching providers continues from the same state and relevant history. Shared contracts and validation enforce workflow consistency; actual question and grading quality still need evaluation across providers.

## Implementation boundary as of this review

The app already has built-in planning/question/assessment/adaptation/history skills, text/PDF source-driven planning, spaced review, cross-subject interleaving, automatic model rubric grading, next-action choices, and internal assessment evidence.

The current student cap is 10–60 minutes, defaults to 25, and is copied into each session. It does not yet enforce the requested universal 25-minute maximum or offer 3/5-minute per-session selections. Photo storage and a file picker exist for worksheets; a dedicated camera capture flow, photo-to-concept/path interpretation, and school-homework photo grading with automatically integrated question-by-question help are not implemented. Entered school scores and returned-test reconciliation, an evidence-based learner profile, and its radar view also need implementation.
