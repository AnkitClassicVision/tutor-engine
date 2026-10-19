---
name: assess-learning
description: Design and judge Tutor Engine assessments that check the requested concept and actual Bloom demand, separate practice from testing, and require evidence over time before mastery.
version: 1
role: verifier
---

# Assess learning

Follow the shared course contract and [spec Layers 5–7](<../../Tutor Engine — The Shape (v1 spec).md>). Assess the concept in the student's response, its process when visible, and fluency against their own baseline. Do not claim to have checked handwriting, reasoning, or transfer when that evidence was not captured.

Match the demand to Bloom: Remember retrieves; Understand explains or distinguishes examples; Apply uses the idea independently; Analyze locates and explains an error or compares methods; Evaluate judges alternatives with reasons; Create produces a new problem, artifact, or explanation and checks it. The label follows what the student does. A copied explanation, multiple-choice guess, keyword overlap, or pressing a recap checkbox is not proof of a higher rung.

Use fresh prompts on the same concept for homework and assessment. Keep answer keys and rubrics separate from the student question. A school test identifies coverage and pitfalls; write original items rather than copying it. Include relevant figures with the actual data needed to answer. A chart mentioned in a syllabus does not justify inventing its measurements.

Checks use a new setting and withhold coaching until the response. Homework provides immediate corrective feedback and the ordered hint ladder. Lessons may alternate opening/immediate feedback with a short batch review after early success; misses interrupt the batch for teaching. Two confirmed misses call for a new teaching approach, not another repeated drill. A creation opportunity may be scaffolded for a shaky student, but does not award mastery at Create by itself.

Objective keys may be scored locally. Open explanations, Analyze justifications, Evaluate, and Create need an explicit rubric and substantive judgment. The parent has chosen automatic model grading: the account's selected AI judges the actual response against the key/rubric, including reasoning and originality. A valid verdict with confidence at least 0.8 counts automatically; malformed, uncertain, or failed calls stay pending with a parent-review fallback. Local keyword matches never substitute for this judgment. Preserve the grading reason and provider with the response.

Record the actual concept, Bloom level, date, session, hints, interleaving, time, modality, and diagnosed error. Mastery requires three qualifying successes across two sessions on two days, at least one mixed with another topic, and zero hints per qualifying success under the current engine. A same-day perfect check is diagnostic evidence. Keep review after 7/30 days, and flag three sessions below 70% with the error type.

Return the caller's contract. If a response lacks evidence needed to score, request that evidence or leave it for review; do not infer correctness from length, fluent writing, or model brand.

## Fairness before scoring

Judge only criteria explicitly requested in the question. A rule-only prompt does not require every procedural step; a steps-only prompt does not require calculations or a final result. If a key includes unrequested material, evaluate the clearly requested part; if the mismatch prevents a fair judgment, leave it unresolved. Identify a missing requested step specifically and kindly. Short correct reasoning can meet the rubric; length alone is neither success nor an error diagnosis.
