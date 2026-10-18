export interface ContentSkill {
  name: string
  when: string
  write: string
}

/** Teaching moves the model always has. The parent does not pick among them. */
export const CONTENT_SKILLS: ContentSkill[] = [
  {
    name: "Say the idea back",
    when: "The topic is not started or shaky.",
    write: "Ask the student to say the rule in their own words. The answer is that idea in one sentence.",
  },
  {
    name: "Explain why",
    when: "They can do the step, or a miss was about the reason rather than the arithmetic.",
    write: "Ask why the step works. A bare number is not a full answer.",
  },
  {
    name: "A real situation",
    when: "The idea should leave a bare drill, and the student is past the first try.",
    write: "Write a short situation with only the numbers they need. No trick wording.",
  },
  {
    name: "More than one step",
    when: "Strength is Getting there or Solid, and the recent misses are not most of the work.",
    write: "The question needs two moves. Keep a shaky topic to one move.",
  },
  {
    name: "Two cases",
    when: "The errors show two ideas mixed up.",
    write: "Put two examples side by side. They pick which one fits and say why.",
  },
  {
    name: "Read the chart",
    when: "The syllabus, the latest note, or the topic mentions a graph, table, chart, or figure.",
    write: "One question includes that figure in words a student can read on paper.",
  },
  {
    name: "A few sentences",
    when: "The subject is an idea, such as reading, science, or social studies, rather than a calculation.",
    write: "Ask for a few sentences. The answer is the idea you will accept.",
  },
  { name: "Prerequisite probe", when: "A miss may come from a foundation rather than the current topic.", write: "Ask one brief question on that prerequisite before deciding what to teach; treat the error cause as a hypothesis." },
  { name: "Faded worked example", when: "The student needs support to use a method.", write: "Show one worked example, leave a step for the student, then use a fresh independent problem. Log support separately." },
  { name: "Delayed retrieval", when: "A demonstrated idea is due for review.", write: "Ask for recall without notes on the same idea and demand; early practice does not replace a delayed check." },
  { name: "Transfer to a new context", when: "Independent work has held and it is time to vary the setting.", write: "Keep the underlying concept, change the meaningful context, and ask the learner to choose the relevant rule." },
  { name: "Calibrated challenge", when: "Comparable evidence indicates work is too easy or difficult.", write: "Adjust one step at a time. Retain established skills in review. Bloom demand and content difficulty are separate; creation is optional rather than required for every learner." },
]

export function contentSkillBrief(): string {
  const lines = CONTENT_SKILLS.map((skill) => `- ${skill.name}. Use when: ${skill.when} Write: ${skill.write}`)
  return [
    "Teaching skills. Use these whenever you write questions. You choose which skills fit this student. There is no parent menu of question types.",
    ...lines,
    "Each topic gets exactly two fresh questions at an evidence-appropriate demand: one addresses the current gap and one checks independent use or transfer. For a new or shaky idea use Remember/Understand/Apply as appropriate. Offer Analyze/Evaluate/Create as further challenges when supported, not as a mandatory question for every topic.",
    "Stored curriculum question prompts must be fresh unaided checks. Put worked examples and faded support in the topic example or lesson, not inside a stored assessment question. Do not supply intermediate calculations or solved method steps in those questions.",
    "Homework and assessment may practice the same topic. They must not share a sentence. A later set may be similar and must still be new wording.",
    "If the topic is shaky or has misses, aim one question at the missing piece.",
    "If the topic is not started or shaky, one question can also ask them to say the idea back.",
    "If the source mentions a graph, table, chart, or figure, one question uses Read the chart.",
    "A school test or parent note decides what to practice next. It does not decide the question form.",
    "Do not copy questions from a test. Write new ones on the same ideas.",
    "No student name. The question must not contain the answer. The answer is short enough to check.",
  ].join("\n")
}

/** The teaching moves without the curriculum's two-questions-per-topic rule; learning packs set their own counts in a runbook. */
export function teachingMovesBrief(): string {
  return [
    "Teaching moves. Choose the ones that fit this learner and this request:",
    ...CONTENT_SKILLS.map((skill) => `- ${skill.name}. Use when: ${skill.when} Write: ${skill.write}`),
  ].join("\n")
}
