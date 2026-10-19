// Reviewers shared by runbooks. A reviewer is a separate call that never sees the writer's notes;
// for question sets it also never sees the answer keys, so it has to solve each question itself.

import { parseNumber } from "../engine/score.ts"
import type { Critic } from "./contract.ts"
import { issue, type Issue } from "./gates.ts"
import type { Schema } from "./schema.ts"

export interface ReviewQuestion { prompt: string; answer: string; bloomLevel: number }

const VERDICT: Schema = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: {
    items: {
      type: "array", maxItems: 40,
      items: {
        type: "object", additionalProperties: false, required: ["id", "answer", "bloom", "onTopic", "ageFit", "issue"],
        properties: {
          id: { type: "integer", minimum: 0 }, answer: { type: "string" },
          bloom: { type: "integer", minimum: 1, maximum: 6 },
          onTopic: { type: "integer", minimum: 1, maximum: 5 }, ageFit: { type: "integer", minimum: 1, maximum: 5 },
          issue: { type: "string" },
        },
      },
    },
  },
}

export const QUESTION_REVIEW_BRIEF = [
  "You independently review questions written for one child. You do not see the answer keys.",
  "For each question: answer it yourself carefully in the form it asks for; say which Bloom demand it really makes (1 remember, 2 understand, 3 apply, 4 analyze, 5 evaluate, 6 create), judged from what the child must do, not from its label; rate onTopic 1-5 for how well it practises the stated topic; rate ageFit 1-5 for wording and difficulty at the stated grade; in issue, name any real problem (ambiguous, more than one right answer, factual error, missing information, unclear wording, gives away the answer, unsafe) or leave it empty.",
  "Return {\"items\": [{\"id\", \"answer\", \"bloom\", \"onTopic\", \"ageFit\", \"issue\"}]} with one entry per question, using the id you were given.",
].join("\n")

const sameNumber = (a: string, b: string) => {
  const x = parseNumber(a.replace(/^rubric:\s*/i, "")), y = parseNumber(b)
  return x && y ? Math.abs(x.n / x.d - y.n / y.d) < 1e-9 : null
}

/** Turns a blind review into issues: wrong-looking keys, overstated demand, off-topic or ill-fitting items. */
export function judgeQuestions(verdict: Record<string, unknown>, questions: ReviewQuestion[]): Issue[] {
  const found: Issue[] = []
  const items = (verdict.items as Array<Record<string, any>>) ?? []
  questions.forEach((question, id) => {
    const review = items.find(item => item.id === id)
    if (!review) { found.push(issue("review_missing", "The reviewer skipped this question.", false, id)); return }
    if (String(review.issue ?? "").trim()) found.push(issue("review_problem", "The reviewer found a problem with this question.", true, id))
    if (review.onTopic < 3) found.push(issue("off_topic", "The reviewer found this question off topic.", true, id))
    if (review.ageFit < 3) found.push(issue("age_fit", "The reviewer found this question a poor fit for the grade.", true, id))
    if (sameNumber(question.answer, String(review.answer)) === false) found.push(issue("key_disagrees", "The reviewer's own answer differs from the key.", true, id))
    const gap = question.bloomLevel - Number(review.bloom)
    if (gap >= 2) found.push(issue("bloom_overstated", `Labelled Bloom ${question.bloomLevel} but asks for about ${review.bloom}.`, true, id))
    else if (gap === 1) found.push(issue("bloom_overstated", `Labelled Bloom ${question.bloomLevel} but may ask for ${review.bloom}.`, false, id))
  })
  return found
}

export function questionCritic<I, O>(questions: (output: O) => ReviewQuestion[], context: (input: I) => { topic: string; grade: number }): Critic<I, O> {
  return {
    brief: QUESTION_REVIEW_BRIEF,
    schema: VERDICT,
    view: (output, input) => ({ ...context(input), questions: questions(output).map((question, id) => ({ id, prompt: question.prompt })) }),
    judge: (verdict, output) => judgeQuestions(verdict, questions(output)),
  }
}
