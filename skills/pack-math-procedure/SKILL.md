---
name: pack-math-procedure
description: Runbook for a learning pack that practises one math procedure the learner asked for, such as adding fractions with unlike denominators, long division or rounding.
subjects: math
keywords: add, adding, subtract, multiply, multiplication, divide, division, fraction, fractions, decimal, decimals, percent, round, rounding, place value, times tables, equation, equations, exponent, integer, integers, ratio, factor, multiple, simplify, order of operations
formats: number, choice, written
bloom: 1-4
require_work: true
---

# Math procedure pack

The learner or parent named a procedure. Every question practises that procedure, and only that procedure.

## Balance across a skill

The shares below are for six questions. When the pack asks for more or fewer, keep the same shares: about a third at the starting level, half one step up, and the rest stretch.

1. Two at the starting level: the bare procedure with friendly numbers (e.g. 1/2 + 1/4).
2. Three one step up: less friendly numbers, a missing piece, or the procedure inside a one-step context.
3. One stretch: a two-step problem, spotting an error in worked steps (Bloom 4, written), or explaining why the method works.

Split the request into one to three skills only when it truly holds separate procedures ("add and subtract fractions" → adding, subtracting). Order skills from the foundation up.

## Writing each question

- Use `number` for anything with a numeric answer. `work` must be a plain arithmetic expression whose exact value is the answer (`3/4 + 1/6`). Code recomputes it; if it does not match, the question is thrown away.
- Answers are exact: fractions in lowest terms unless the request says otherwise, decimals without trailing zeros, units after the number (`12 cm`).
- Use `choice` sparingly, for recognising the right step or the right estimate. Wrong options must be the answers of real mistakes (adding denominators, forgetting to carry), never random numbers.
- Use `written` only for the stretch error-spotting or explain-why question; the answer starts with `Rubric:` and names the idea that must appear.
- Grade fit: numbers sized for the learner's grade. Never use content more than one grade above unless the request asks for it.

## Hints

Three hints that walk the method: what to look at first, the next move, the last move before the answer. No hint may contain the answer or the final calculation.

## Lesson

- Hook: one sentence about where this shows up.
- Steps: the method in two to four short steps.
- Worked example: one full example with different numbers from every question.
- Quick check: one easy question with its answer.

## Good and bad

- Good: "Add 2/3 + 1/4." work `2/3 + 1/4`, answer `11/12`.
- Good: "Which is the first step to add 3/5 + 1/2?" choices: find a common denominator; add the tops and bottoms; multiply the denominators only.
- Bad: "Solve the fraction problem." (no numbers to work with)
- Bad: answer `0.50` for 1/2 when the request is about fractions (format the learner did not ask for).
