import { fractionString } from "./score.ts"
import { authoredFractionTask } from './fraction-forms.ts'
import type { BloomLevel, ConceptNode, Item, Mode } from "./types.ts"

export function generateItem(
  concept: ConceptNode,
  bloom: BloomLevel,
  seed: number,
  options: { interleaved?: boolean; partner?: ConceptNode | null; surface?: Mode; itemId?: string; role?: 'practice' | 'transfer' } = {},
): Item {
  const level = (bloom < 1 ? 1 : bloom) as BloomLevel
  const surface = options.surface ?? defaultSurface(level)
  const authored = options.interleaved ? null : authoredFractionTask(concept.conceptId, level, seed, options.role)
  if (authored) return {
    itemId: options.itemId ?? concept.conceptId + ':' + level + ':' + seed, conceptId: concept.conceptId, bloomLevel: level,
    prompt: authored.prompt, answer: authored.answer, hintLadder: authored.hints,
    ...(authored.format === 'choice' || authored.format === 'steps' ? { responseFormat: authored.format } : {}),
    choices: authored.choices, rubric: authored.rubric, evidenceKind: authored.role,
    surface, interleaved: false, partnerConceptId: null, scored: level <= 4,
  }
  let built = build(concept, level, seed, options.partner ?? null)
  if (options.interleaved && options.partner && level <= 4) {
    const partner = build(options.partner, Math.min(3, level) as BloomLevel, seed + 137, null)
    built = {
      prompt: `Two ideas in a new context. First: ${partner.prompt}\nThen: ${built.prompt}\nGive both responses and explain which rule belongs to each.`,
      answer: `Rubric: answer the first question using ${options.partner.recall}; key: ${partner.answer}. Answer the second using ${concept.recall}; key: ${built.answer}. Keep the rules distinct.`,
      hints: built.hints,
    }
  }
  return {
    itemId: options.itemId ?? `${concept.conceptId}:${level}:${seed}`,
    conceptId: concept.conceptId,
    bloomLevel: level,
    prompt: built.prompt,
    answer: built.answer,
    hintLadder: built.hints,
    ...(!(options.interleaved && options.partner && level <= 4) && level === 1 && concept.conceptId.startsWith('math.') ? { responseFormat: 'steps' as const } : {}),
    ...(!(options.interleaved && options.partner && level <= 4) && level === 2 ? { responseFormat: 'choice' as const, choices: ['A', 'B'] } : {}),
    surface,
    interleaved: options.interleaved ?? false,
    partnerConceptId: options.partner?.conceptId ?? null,
    scored: level <= 4,
  }
}

function defaultSurface(bloom: BloomLevel): Mode {
  if (bloom <= 2) return "voice"
  if (bloom === 3) return "paper"
  return "screen"
}

/** "Compute 454 + 506." becomes "work out 454 + 506", so the question asks for steps without ordering a calculation. */
function stepsTask(prompt: string) {
  const task = prompt.trim().replace(/[.?!]+$/, "").replace(/^(Compute|Calculate|Find|Work out|Solve|What is)\s+/i, "work out ")
  if (/^work out /.test(task)) return task
  if (/^(Add|Subtract|Multiply|Divide|Compare|Simplify|Round|Convert|Order|Estimate|Write|Show)\b/.test(task)) return task.charAt(0).toLowerCase() + task.slice(1)
  return `solve this: ${task}`
}

function build(concept: ConceptNode, bloom: BloomLevel, seed: number, partner: ConceptNode | null) {
  if (bloom === 1) {
    return {
      prompt: concept.conceptId.startsWith("math.") ? `Tell me, in order, the steps you would use to ${stepsTask(applyProblem(concept, seed).prompt)}. You do not need to work out the final answer.` : `In your own words, name the main idea or steps for "${concept.title}". You do not need to solve an example yet.`,
      answer: `Rubric: accept an equivalent description in the learner's own words of this idea or procedure: ${concept.recall}. No calculation, final answer, exact wording, or extra steps beyond the requested procedure are required.`,
      hints: hintsFor(concept.recall, `What does "${concept.title}" change, keep, or undo?`),
    }
  }
  if (bloom === 2) {
    const flip = seed % 2 === 1
    const applied = concept.conceptId.startsWith("math.") ? applyProblem(concept, seed) : null
    const example = applied ? `${applied.prompt} ${applied.step1} ${applied.step2} ${applied.step3}` : concept.example
    const nonExample = applied ? `${applied.prompt} ${applied.wrongStep}` : concept.nonExample
    const a = flip ? nonExample : example
    const b = flip ? example : nonExample
    const answer = flip ? "B" : "A"
    return {
      prompt: `Which one shows ${concept.title}?\nA) ${a}\nB) ${b}\nReply A or B.`,
      answer,
      hints: hintsFor(answer, "Which choice follows the rule, and which one breaks it?"),
    }
  }
  if (bloom === 5) {
    return {
      prompt: `Two students propose these approaches to ${concept.title}:\nA) ${concept.example}\nB) ${concept.nonExample}\nJudge both approaches. Explain which is valid, why, and how you would check it.`,
      answer: `Rubric: judge the alternatives and justify using this idea: ${concept.recall}. Explain why the invalid approach fails and give a check.`,
      hints: hintsFor("a justified judgment", "What rule would you use to judge each approach?"),
    }
  }
  if (bloom === 6) {
    const audience = partner ? ` Use ${partner.title.toLowerCase()} in the problem.` : ""
    return {
      prompt: `Write a problem that would teach a friend ${concept.title}.${audience} Then say how you would know their answer is right.`,
      answer: `Rubric: create an original problem and a valid answer/check using this idea: ${concept.recall}. A copied example alone does not count.`,
      hints: hintsFor("a new problem", "What is one number, one wrong move, and one check?"),
    }
  }
  const applied = applyProblem(concept, seed)
  if (bloom === 3) {
    return {
      prompt: applied.prompt,
      answer: applied.answer,
      hints: hintsFor(applied.answer, applied.nudge),
    }
  }
  const wrongStep = (seed % 3) + 1
  const steps = [applied.step1, applied.step2, applied.step3]
  const shown = steps.map((step, index) => {
    if (index + 1 !== wrongStep) return step
    return applied.wrongStep
  })
  return {
    prompt: `${applied.prompt}\nStep 1: ${shown[0]}\nStep 2: ${shown[1]}\nStep 3: ${shown[2]}\nFind the first wrong step. Explain why it is wrong and write a corrected step.`,
    answer: `Rubric: identify step ${wrongStep}, explain the error, and correct it using this idea: ${concept.recall}. Correct step: ${steps[wrongStep - 1]}.`,
    hints: hintsFor("an explanation and corrected step", "Check each step against the one before it."),
  }
}

function hintsFor(answer: string, nudge: string): [string, string, string] {
  return [
    nudge,
    "Do the next step only. Leave the final result unwritten.",
    `One worked path ends at ${answer}. Now do the parallel problem without looking back.`,
  ]
}

interface Applied {
  prompt: string
  answer: string
  nudge: string
  step1: string
  step2: string
  step3: string
  wrongStep: string
}

const CASES = [
  ["Cairo", "the Nile"],
  ["a port on the Persian Gulf", "the desert behind the port"],
  ["a village by the Mekong", "the river flood"],
  ["Mombasa", "the harbor"],
  ["a town in the Atlas Mountains", "the mountain pass"],
  ["a farm near the Ganges", "the monsoon rains"],
  ["Muscat", "the coast"],
  ["Singapore", "the strait"],
]

const CONTEXTS = ["school", "everyday life", "a project", "a game", "an unfamiliar situation", "a story", "a demonstration", "a problem you invent"]

export function designQuestion(input: {
  title: string
  recall: string
  job: "homework" | "assessment"
  kind: "apply" | "create" | "gap"
  seed: number
  seen?: string[]
}): { prompt: string; answer: string; bloom: number } {
  const idea = plainIdea(input.recall, input.title)
  const seen = new Set((input.seen ?? []).map((prompt) => prompt.trim()))
  const shift = input.job === "assessment" ? 3 : 0
  for (let step = 0; step < CASES.length * 3; step += 1) {
    const [place, feature] = CASES[(Math.abs(input.seed) + step + shift) % CASES.length]!
    const where = step < CASES.length ? place : `${place} in ${1960 + ((Math.abs(input.seed) + step) % 50)}`
    const setting = /land|water|map|region|river/i.test(idea)
      ? `Use ${where} as the setting.`
      : `Use an example from ${CONTEXTS[(Math.abs(input.seed) + step + shift) % CONTEXTS.length]}. Explain it to ${step < CASES.length ? "a classmate" : step < CASES.length * 2 ? "a younger student" : "a teacher"}.`
    const prompt = `Topic: ${input.title}.\n${scene(input.job, input.kind, idea, where, feature)} ${setting}`
    if (seen.has(prompt)) continue
    return { prompt, answer: rubric(input.kind, idea, where), bloom: input.kind === "create" ? 6 : 3 }
  }
  const [place, feature] = CASES[Math.abs(input.seed) % CASES.length]!
  return {
    prompt: scene(input.job, input.kind, idea, `${place} last year`, feature),
    answer: rubric(input.kind, idea, place),
    bloom: input.kind === "create" ? 6 : 3,
  }
}

function plainIdea(recall: string, title: string) {
  const cleaned = recall.replace(/^I can /i, "").replace(/\.$/, "").trim()
  const idea = cleaned.length > 12 && cleaned.toLowerCase() !== title.trim().toLowerCase() ? cleaned : title.trim()
  return idea.charAt(0).toUpperCase() + idea.slice(1)
}

function scene(job: "homework" | "assessment", kind: "apply" | "create" | "gap", idea: string, where: string, feature: string) {
  if (kind === "create" && job === "assessment") {
    return "Write a new test question on this topic. Answer it and explain your check. Then name one mistake that would show the idea is still missing."
  }
  if (kind === "create") {
    return "Write two or three sentences describing a new example of this topic. Explain why it fits. Then write a check a teacher could use to decide if the answer is solid."
  }
  if (kind === "gap") {
    return "A classmate wrote only the topic's name and gave no explanation. What is missing? Write an example and explain the idea it shows."
  }
  if (job === "assessment") {
    return "Apply this topic in a new example you have not practiced. Explain what a solid answer must include and how you would check it."
  }
  if (/land|water|map|region|river/i.test(idea)) {
    return `A map of ${where} shows ${feature}. Explain how land and water could affect where people live or travel. What evidence would you look for on the map?`
  }
  return "Describe a situation where you would use this topic. Apply it to that situation and explain how you would check your answer."
}

function rubric(kind: "apply" | "create" | "gap", idea: string, where: string) {
  const move = kind === "create" ? "creates a new example or question" : kind === "gap" ? "shows the missing piece and the solid version" : "uses the idea in the place"
  return `Rubric: a solid answer ${move}. The idea that must be in it: ${idea}. The place is ${where}. A title alone does not count.`
}

export function localQuestions(concept: { title: string; recall: string }) {
  return [
    designQuestion({ title: concept.title, recall: concept.recall, job: "homework", kind: "apply", seed: 1 }),
    designQuestion({ title: concept.title, recall: concept.recall, job: "homework", kind: "create", seed: 2 }),
    designQuestion({ title: concept.title, recall: concept.recall, job: "assessment", kind: "apply", seed: 3 }),
    designQuestion({ title: concept.title, recall: concept.recall, job: "assessment", kind: "create", seed: 4 }),
  ]
}

export function applyProblem(concept: ConceptNode, seed: number): Applied {
  if (!concept.conceptId.startsWith("math.")) {
    const picked = designQuestion({ title: concept.title, recall: concept.recall, job: "homework", kind: "apply", seed })
    return {
      prompt: picked.prompt,
      answer: picked.answer,
      nudge: "What is the idea, in one sentence?",
      step1: concept.recall || concept.title,
      step2: "Give one example that fits the idea.",
      step3: "Say how you would know an answer is off.",
      wrongStep: concept.nonExample || "A label with no idea.",
    }
  }
  const rand = mulberry32(seed || 1)
  const pick = (mod: number) => Math.floor(rand() * mod)
  const id = concept.conceptId

  if (id.startsWith("math.primary.")) {
    const [, , gradeRaw, operation] = id.split(".")
    const grade = Number(gradeRaw), a = 2 + pick(grade === 1 ? 7 : 8), b = 2 + pick(7)
    let prompt = "", answer = "", step = "", wrongStep = ""
    if (operation === "count") { prompt = `How many dots? ${"● ".repeat(a)}`; answer = String(a); step = "Point to each dot once as you count."; wrongStep = `Skip the first dot and report ${a - 1}.` }
    if (operation === "add") { const x = grade === 1 ? a : 10 + a * 2, y = grade === 1 ? b : 10 + b; prompt = `You have ${x} shells and find ${y} more. How many now?`; answer = String(x + y); step = `Join ${x} and ${y}.`; wrongStep = `Take away instead: ${x} − ${y} = ${x - y}.` }
    if (operation === "subtract") { const x = grade === 1 ? a + b : 30 + a, y = grade === 1 ? b : 10 + b; prompt = `There are ${x} balloons. ${y} float away. How many remain?`; answer = String(x - y); step = `Take ${y} away from ${x}.`; wrongStep = `Add instead: ${x} + ${y} = ${x + y}.` }
    if (operation === "place") { const number = 10 * a + b; prompt = `How many tens are in ${number}?`; answer = String(a); step = `Split ${number} into tens and ones.`; wrongStep = `Count one extra ten and report ${a + 1} tens.` }
    if (operation === "multiply") { prompt = `${a} baskets hold ${b} apples each. How many apples altogether?`; answer = String(a * b); step = `Add ${b} once for each of the ${a} baskets.`; wrongStep = `Count an extra basket: ${a + 1} × ${b} = ${(a + 1) * b}.` }
    if (operation === "divide") { prompt = `Share ${a * b} beads equally among ${a} friends. How many does each get?`; answer = String(b); step = `What number multiplied by ${a} makes ${a * b}?`; wrongStep = `Give all ${a * b} beads to each of the ${a} friends.` }
    if (operation === "fraction") { const parts = b + 1; prompt = `A shape has ${parts} equal parts. One part is shaded. What fraction is shaded?`; answer = `1/${parts}`; step = "Count all equal parts, then count shaded parts."; wrongStep = `Reverse the counts and write ${parts}/1.` }
    return { prompt, answer, nudge: "What do you know? What are you finding?", step1: concept.recall, step2: step, step3: `The answer is ${answer}.`, wrongStep }
  }

  if (id === "math.5.nf.a.1" || id === "math.4.nf.b.3") {
    const denoms = [2, 3, 4, 5, 6, 8, 10, 12]
    const b = denoms[pick(denoms.length)]
    let d = denoms[pick(denoms.length)]
    if (id === "math.4.nf.b.3") d = b
    else if (d === b) d = denoms[(denoms.indexOf(b) + 1) % denoms.length]
    const a = 1 + pick(5)
    const c = 1 + pick(5)
    const answer = fractionString(a * d + c * b, b * d)
    return {
      prompt: `Add ${a}/${b} + ${c}/${d}.`,
      answer,
      nudge: "What denominator is a multiple of both denominators?",
      step1: `Common denominator is ${lcm(b, d)}.`,
      step2: `Rewrite as ${a * (lcm(b, d) / b)}/${lcm(b, d)} + ${c * (lcm(b, d) / d)}/${lcm(b, d)}.`,
      step3: `The sum is ${answer}.`,
      wrongStep: `Add the denominators to get ${a + c}/${b + d}.`,
    }
  }

  if (id === "math.4.nf.a.1") {
    const b = [2, 3, 4, 5][pick(4)]
    const a = 1 + pick(b - 1)
    const k = 2 + pick(3)
    const answer = `${a * k}/${b * k}`
    return {
      prompt: `Write a fraction equal to ${a}/${b} with denominator ${b * k}.`,
      answer,
      nudge: "What do you multiply the numerator by?",
      step1: `The denominator was multiplied by ${k}.`,
      step2: `Multiply the numerator by ${k}.`,
      step3: `The equivalent fraction is ${answer}.`,
      wrongStep: `Add ${k} to the numerator and get ${a + k}/${b * k}.`,
    }
  }

  if (id === "math.4.nf.a.2") {
    const b = 2 + pick(11), d = 2 + pick(11), a = 1 + pick(b - 1)
    let c = 1 + pick(d - 1)
    // Keep the task a comparison of unequal proper fractions, with enough distinct cases for fresh checks.
    if (a * d === c * b) c = c < d - 1 ? c + 1 : 0
    const left = a / b
    const right = c / d
    const answer = left >= right ? `${a}/${b}` : `${c}/${d}`
    return {
      prompt: `Which is greater, ${a}/${b} or ${c}/${d}? Reply with the fraction.`,
      answer,
      nudge: "Can you rewrite both with the same denominator?",
      step1: `Common denominator is ${lcm(b, d)}.`,
      step2: `${a}/${b} = ${a * (lcm(b, d) / b)}/${lcm(b, d)} and ${c}/${d} = ${c * (lcm(b, d) / d)}/${lcm(b, d)}.`,
      step3: `${answer} is greater.`,
      wrongStep: "The fraction with the larger denominator is greater.",
    }
  }

  if (id === "math.5.nf.b.4") {
    const a = 1 + pick(4)
    const b = 2 + pick(4)
    const c = 1 + pick(4)
    const d = 2 + pick(4)
    const answer = fractionString(a * c, b * d)
    return {
      prompt: `Multiply ${a}/${b} × ${c}/${d}.`,
      answer,
      nudge: "Multiply straight across, top and bottom.",
      step1: `Numerators: ${a} × ${c} = ${a * c}.`,
      step2: `Denominators: ${b} × ${d} = ${b * d}.`,
      step3: `The product is ${answer}.`,
      wrongStep: `Cross-add to get ${a + d}/${b + c}.`,
    }
  }

  if (id === "math.5.nf.b.7") {
    const b = 2 + pick(6)
    const c = 2 + pick(4)
    const answer = `1/${b * c}`
    return {
      prompt: `Compute (1/${b}) ÷ ${c}.`,
      answer,
      nudge: "How many equal pieces is each piece being split into?",
      step1: `Start with 1/${b}.`,
      step2: `Split each piece into ${c}.`,
      step3: `The quotient is ${answer}.`,
      wrongStep: `Multiply the numerator by ${c} and get ${c}/${b}.`,
    }
  }

  if (id === "math.6.ee.b.7") {
    const addend = 2 + pick(8)
    const result = addend + 2 + pick(8)
    const answer = String(result - addend)
    return {
      prompt: `Solve x + ${addend} = ${result}.`,
      answer,
      nudge: "What undoes adding that number?",
      step1: `Subtract ${addend} from both sides.`,
      step2: `x = ${result} - ${addend}.`,
      step3: `x = ${answer}.`,
      wrongStep: `Add ${addend} again and get x = ${result + addend}.`,
    }
  }

  if (id === "math.8.ee.c.7") {
    const a = 2 + pick(5), b = 1 + pick(6), x = 1 + pick(8)
    const result = a * (x + b)
    return {
      prompt: `Solve ${a}(x + ${b}) = ${result}. Reply with x.`, answer: String(x),
      nudge: "What does the multiplier apply to inside the parentheses?",
      step1: `Expand: ${a}x + ${a * b} = ${result}.`,
      step2: `Subtract ${a * b}: ${a}x = ${a * x}.`, step3: `Divide by ${a}: x = ${x}.`,
      wrongStep: `Expand as ${a}x + ${b} = ${result}, multiplying only x.`,
    }
  }
  if (id === "math.7.ee.b.4") {
    const coef = 2 + pick(4)
    const x = 2 + pick(6)
    const addend = 1 + pick(6)
    const result = coef * x + addend
    return {
      prompt: `Solve ${coef}x + ${addend} = ${result}.`,
      answer: String(x),
      nudge: "Undo the added number before you divide.",
      step1: `Subtract ${addend}: ${coef}x = ${result - addend}.`,
      step2: `Divide by ${coef}.`,
      step3: `x = ${x}.`,
      wrongStep: `Divide first and get x = ${result}/${coef} - ${addend}.`,
    }
  }

  if (id === "math.7.rp.a.3") {
    const percents = [10, 20, 25, 50]
    const p = percents[pick(percents.length)]
    const bases = [20, 40, 60, 80]
    const n = bases[pick(bases.length)]
    const answer = String((p / 100) * n)
    return {
      prompt: `What is ${p}% of ${n}? Reply with the number only.`,
      answer,
      nudge: "Percent means out of 100. What is one hundredth of the number, scaled?",
      step1: `${p}% = ${p}/100.`,
      step2: `Multiply ${n} by ${p}/100.`,
      step3: `The result is ${answer}.`,
      wrongStep: `Add ${p} and ${n} to get ${p + n}.`,
    }
  }

  if (id === "math.6.rp.a.3") {
    const unit = 2 + pick(5)
    const count = 2 + pick(4)
    const next = count + 1 + pick(3)
    const answer = String(unit * next)
    return {
      prompt: `If 1 item costs $${unit}, what is the cost of ${next} items? Reply with the number only.`,
      answer,
      nudge: "Each item costs the same amount. What do you repeat?",
      step1: `One item costs ${unit}.`,
      step2: `Multiply by ${next}.`,
      step3: `The cost is ${answer}.`,
      wrongStep: `Add ${next} to the price and get ${unit + next}.`,
    }
  }

  if (id === "math.hsa.apr.a.1") {
    const a = 1 + pick(5)
    const b = 1 + pick(6)
    const c = 1 + pick(5)
    const d = 1 + pick(6)
    const answer = `${a + c}x + ${b + d}`
    return {
      prompt: `Add (${a}x + ${b}) + (${c}x + ${d}).`,
      answer,
      nudge: "Which terms have an x, and which are plain numbers?",
      step1: `x terms: ${a}x + ${c}x = ${a + c}x.`,
      step2: `Constants: ${b} + ${d} = ${b + d}.`,
      step3: `The sum is ${answer}.`,
      wrongStep: `Add everything into one number and get ${a + b + c + d}.`,
    }
  }

  if (id === "math.4.nbt.b.5") {
    const a = 12 + pick(20)
    const b = 3 + pick(6)
    const answer = String(a * b)
    return integerWork(`Multiply ${a} × ${b}.`, answer, `Break ${a} apart, then multiply by ${b}.`, `${a} × ${b} = ${answer}.`, `${a} + ${b} = ${a + b}.`)
  }

  if (id === "math.4.nbt.b.6") {
    const b = 3 + pick(6)
    const q = 11 + pick(20)
    const a = b * q
    return integerWork(`Divide ${a} ÷ ${b}.`, String(q), "What number times the divisor gives the dividend?", `${b} × ${q} = ${a}.`, `${a} - ${b} = ${a - b}.`)
  }

  if (id === "math.6.ee.a.2") {
    const x = 2 + pick(8), b = 2 + pick(7)
    return integerWork(`Evaluate x + ${b} when x = ${x}.`, String(x + b), "Replace the variable with its given value.", `${x} + ${b} = ${x + b}.`, `Multiply instead: ${x} × ${b} = ${x * b}.`)
  }
  if (id === "math.6.rp.a.1") {
    const a = 2 + pick(7), b = 2 + pick(5)
    return integerWork(`There are ${a} red beads and ${b} blue beads. Write the ratio of red to blue as a:b.`, `${a}:${b}`, "Which quantity comes first in the question?", `Red to blue is ${a}:${b}.`, `Subtract to get a ratio of ${a - b}.`)
  }
  if (id === "math.6.ns.b.3") {
    const a = 12 + pick(45), b = 5 + pick(20)
    return integerWork(`Add ${(a / 10).toFixed(1)} + ${(b / 100).toFixed(2)}.`, ((10 * a + b) / 100).toFixed(2), "Line up the decimal places.", `In hundredths: ${10 * a} + ${b} = ${10 * a + b}.`, `Treat both numbers as tenths and get ${(a + b) / 10}.`)
  }
  if (id === "math.7.ns.a.1") {
    const a = 2 + pick(8), b = a + 1 + pick(8)
    return integerWork(`Compute ${a} + (-${b}).`, String(a - b), "Adding a negative moves left on the number line.", `${a} - ${b} = ${a - b}.`, `Ignore the sign: ${a} + ${b} = ${a + b}.`)
  }
  if (id === "math.8.ee.a.1") {
    const a = 2 + pick(4)
    let b = 2 + pick(4)
    if (a === 2 && b === 2) b = 3
    return integerWork(`Write 2^${a} × 2^${b} as 2^n. What is n?`, String(a + b), "Count the factors of the same base.", `Add the exponents: ${a} + ${b} = ${a + b}.`, `Multiply the exponents: ${a} × ${b} = ${a * b}.`)
  }
  if (id === "math.8.f.b.4") {
    const m = 2 + pick(5), b = 1 + pick(6), x = 2 + pick(8)
    return integerWork(`A linear model is y = ${m}x + ${b}. Find y when x = ${x}.`, String(m * x + b), "Use the input in the linear rule.", `y = ${m * x} + ${b} = ${m * x + b}.`, `Add all numbers: y = ${m + x + b}.`)
  }
  if (id === "math.hsa.apr.b.3") {
    const a = 1 + pick(5), b = a + 1 + pick(5)
    return {
      prompt: `Factor x^2 - ${a + b}x + ${a * b} and give the smaller zero. Reply with that zero.`, answer: String(a),
      nudge: "Which two numbers multiply to the constant and sum to the middle coefficient?",
      step1: `The roots have sum ${a + b} and product ${a * b}.`,
      step2: `Factor as (x - ${a})(x - ${b}).`, step3: `Zeros are ${a} and ${b}; the smaller is ${a}.`,
      wrongStep: `Choose ${a * b} as the zero just because it is the constant.`,
    }
  }
  if (id === "math.hsa.rei.b.4") {
    const x = 2 + pick(8)
    return {
      prompt: `Solve x^2 = ${x * x}. Give both solutions separated by a comma, negative first.`, answer: `-${x}, ${x}`,
      nudge: "What happens when a negative number is squared?",
      step1: `Take square roots of ${x * x}.`, step2: `Both ${x} and -${x} square to ${x * x}.`,
      step3: `Solutions are -${x} and ${x}.`, wrongStep: `Only ${x} is a solution because square roots are always positive.`,
    }
  }
  if (id === "math.4.nbt.b.4") {
    const a = 120 + pick(800), b = 110 + pick(400)
    return integerWork(`Compute ${a} + ${b}.`, String(a + b), "Add the ones, then the tens and hundreds.", `${a} + ${b} = ${a + b}.`, `${a} - ${b} = ${a - b}.`)
  }
  throw new Error(`No Apply generator for ${id}.`)
}

function integerWork(prompt: string, answer: string, nudge: string, good: string, bad: string): Applied {
  return {
    prompt,
    answer,
    nudge,
    step1: "Write the problem in one line.",
    step2: good,
    step3: `The result is ${answer}.`,
    wrongStep: bad,
  }
}

function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcdSafe(a, b)
}

function gcdSafe(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const next = x % y
    x = y
    y = next
  }
  return x || 1
}

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
