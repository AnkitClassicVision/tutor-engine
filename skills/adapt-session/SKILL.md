---
name: adapt-session
description: Adjust Tutor Engine practice from the rolling six scored answers, diagnosed errors, hints, timing, and attention cap while retaining due review and the current school target.
version: 1
role: coach
---

# Adapt the session

Use the shared course contract and actual attempt records. Read [the spec](<../../Tutor Engine — The Shape (v1 spec).md>), Layers 3–6, when it is not supplied. The engine, not the AI provider, executes these decisions.

Re-evaluate after every confirmed score using the most recent six fresh, unaided, confirmed items for the same concept and Bloom demand, accumulated across short sessions. Before six, hold difficulty unless the time, frustration, or attention rules apply. At six, 6/6 steps up, 5/6 holds, and 4/6 or fewer steps down. Continue using the rolling window; do not require another fixed six-question batch.

Step up one Bloom rung, reduce support, or vary context. Step down one rung or use the corrective for the error. After two successive step-downs, change modality before easing further. A hold or successful item breaks a run of step-downs. Use the student's own median time: beyond twice that median, or frustration, provide support and a break. The attention/session cap always ends work.

Keep target priority, weak foundations, due retrieval, and interleaving. Retention probes check a level already mastered; frontier explores the next rung. Adjust only unanswered work. A reserved parent/model question must not exempt the next item from adaptation; replace it with a suitable question and preserve its concept and history. Do not relabel an unchanged task as a different Bloom level. Printed sheets remain fixed; apply their evidence to the next work.

Only confirmed local, model, or parent scores enter the window. Exclude supported work, homework and repeated prompts. Content grade and Bloom demand are separate; do not use success in one topic to adjust another. Treat error labels as tentative; answer length and latency are not diagnoses. A pending judgment is not a success or a failure. Log every hint and preserve the actual hints/interleaving when recording evidence. Do not turn a short high score into course advancement or mastery. Diagnose the missing idea before increasing complexity; a new school source changes focus without erasing prior evidence.

When asked to recommend topics, return only offered IDs and the caller's reason field. When explaining a result, use a short explanation plus one next question or teaching move; do not invent unmeasured constraints or claim an adjustment the engine did not make.

## Feedback and repeated difficulty

Homework receives corrective feedback after each confirmed response. Lessons use immediate feedback for the opening probes, support and misses, and may review a short three-question batch after early successes. Independent checks withhold coaching until completion. A batch review looks for patterns without declaring an error cause proven. After two confirmed misses on a topic in a teaching mission, stop drilling that topic and explain a worked example or clarify a prerequisite. This teaching pause is separate from the six-comparable-item rule for difficulty/mastery. Never reissue an answered prompt or repeated recall drill; prepare fresh questions when a dynamic class exhausts its pool. Keep the original attempts and archived queue records.
