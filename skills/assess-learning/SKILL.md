---
name: assess-learning
description: Design and judge Tutor Engine assessments that check the requested concept and actual Bloom demand, separate practice from testing, and require evidence over time before mastery.
version: 3
role: verifier
---

# Assess learning

Follow the shared course contract and [spec Layers 5–7](<../../Tutor Engine — The Shape (v1 spec).md>). Assess the concept in the student's response, its process when visible, and fluency against their own baseline. Do not claim to have checked handwriting, reasoning, or transfer when that evidence was not captured.

Match the demand to Bloom: Remember retrieves; Understand explains or distinguishes examples; Apply uses the idea independently; Analyze locates and explains an error or compares methods; Evaluate judges alternatives with reasons; Create produces a new problem, artifact, or explanation and checks it. The label follows what the student does. A copied explanation, multiple-choice guess, keyword overlap, or pressing a recap checkbox is not proof of a higher rung.

Use fresh prompts on the same concept for homework and assessment. Keep answer keys and rubrics separate from the student question. A school test identifies coverage and pitfalls; write original items rather than copying it. Include relevant figures with the actual data needed to answer. A chart mentioned in a syllabus does not justify inventing its measurements.

Assessments use fresh questions and withhold all coaching, hints, correctness feedback and rewards until the entire declared assessment is submitted. Saving an answer, grading privately, pausing or reaching an attention limit does not open feedback. Show only neutral saved/progress messages. After final submission, feedback and teaching can open, but that assessment cannot be resumed using the revealed answers. Questions left unanswered are not failed attempts. Access supports must not supply the skill being measured (for example, reading a decoding question aloud or dictating a spelling answer).

Homework provides immediate corrective feedback and the ordered hint ladder. Lessons may alternate opening/immediate feedback with a short batch review after early success; misses interrupt the batch for teaching. Two confirmed misses call for a new teaching approach, not another repeated drill. Keep Bloom demand separate from degree of support: preserve comparison, reasoning and creation during supported practice, then fade help and check fresh unaided performance. A scaffolded creation does not award mastery at Create by itself. Delayed retention and transfer are separate evidence, not implied by immediate practice success.

Objective keys may be scored locally. Open explanations, Analyze justifications, Evaluate, and Create need an explicit rubric and substantive judgment. The parent has chosen automatic model grading: the account's selected AI judges the actual response against the key/rubric, including reasoning and originality. The first grade requires confidence of at least 0.85 and agreement from an independent second judgment, also at least 0.85, that never sees the first verdict. Lower confidence, unusable evidence or disagreement requires a separate grounding pass using the rubric and topic material. A valid grounded verdict can count at confidence of at least 0.8; if needed, one further grounding pass addresses the remaining doubts. A faulty question is retired without scoring the child. Unsettled answers go to parent review and failed calls stay pending for retry; neither counts as a miss. Local keyword matches never substitute for this judgment. Preserve the grading reason and provider with the response.

Record the actual concept, Bloom level, date, session, hints, interleaving, time, modality, and diagnosed error. Mastery requires three qualifying successes across two sessions on two days, at least one mixed with another topic, and zero hints per qualifying success under the current engine. A same-day perfect check is diagnostic evidence. Keep review after 7/30 days, and flag three sessions below 70% with the error type.

Return the caller's contract. If a response lacks evidence needed to score, request that evidence or leave it for review; do not infer correctness from length, fluent writing, or model brand.

## Fairness before scoring

Judge only criteria explicitly requested in the question. A rule-only prompt does not require every procedural step; a steps-only prompt does not require calculations or a final result. If a key includes unrequested material, evaluate the clearly requested part; if the mismatch prevents a fair judgment, leave it unresolved. Identify a missing requested step specifically and kindly. Short correct reasoning can meet the rubric; length alone is neither success nor an error diagnosis.
