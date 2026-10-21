import { applyProblem } from './items.ts'
import { fractionString } from './score.ts'
import type { BloomLevel, ConceptNode } from './types.ts'

export interface WorkedExample {
  problem: string
  steps: Array<{ work: string; reason: string }>
  answer: string
  check: string
  caseKey: string
}
export interface Scaffold {
  version: 1
  route: 'conceptual' | 'procedural'
  worked: WorkedExample
  task: { prompt: string; answer: string; bloom: BloomLevel; format: 'text' | 'steps' | 'choice'; choices?: string[]; hints: string[] }
  caseKeys: string[]
}

const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a
const sameUnit = (b: number, d: number) => b * d / gcd(b, d)
const fraction = (a: string, b: string) => fractionString(Number(a), Number(b))

/** Recognizes the mathematical task, including whitespace, ordering and equivalent fraction notation. */
export function fractionCaseKeys(text: string): string[] {
  const keys = new Set<string>()
  for (const m of text.matchAll(/(\d+)\s*\/\s*(\d+)\s*\+\s*(\d+)\s*\/\s*(\d+)/g)) {
    keys.add(`add:${[fraction(m[1], m[2]), fraction(m[3], m[4])].sort().join(':')}`)
  }
  for (const m of text.matchAll(/(?:greater|compare)[^\n.?]{0,16}?(\d+)\s*\/\s*(\d+)\s*(?:or|and|,)\s*(\d+)\s*\/\s*(\d+)/gi)) {
    keys.add(`compare:${[fraction(m[1], m[2]), fraction(m[3], m[4])].sort().join(':')}`)
  }
  for (const m of text.matchAll(/fraction equal to\s+(\d+)\s*\/\s*(\d+)\s+with denominator\s+(\d+)/gi)) {
    keys.add(`equivalent:${fraction(m[1], m[2])}:${m[3]}`)
  }
  for (const m of text.matchAll(/Complete\s+(\d+)\s*\/\s*(\d+)\s*=\s*\?\s*\/\s*(\d+)/gi)) {
    keys.add(`equivalent:${fraction(m[1], m[2])}:${m[3]}`)
  }
  return [...keys]
}

/** Exact-content and arithmetic identity guard; arbitrary model semantics require separate review. */
export function copiesTeaching(prompt: string, sources: string[]): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9/]+/g, ' ').trim()
  const question = normalize(prompt), cases = new Set(fractionCaseKeys(prompt))
  return sources.some(source => {
    const normalized = normalize(source)
    return normalized.length >= 20 && question.includes(normalized)
      || fractionCaseKeys(source).some(key => cases.has(key))
  })
}

/** Arithmetic and every displayed intermediate value are computed here, not supplied by a model. */
export function checkedFractionExample(concept: ConceptNode, seed: number): WorkedExample | null {
  if (!['math.5.nf.a.1', 'math.4.nf.b.3', 'math.4.nf.a.1', 'math.4.nf.a.2'].includes(concept.conceptId)) return null
  const applied = applyProblem(concept, seed)
  const parts = [...applied.prompt.matchAll(/(\d+)\/(\d+)/g)].map(m => [Number(m[1]), Number(m[2])])
  const [a, b] = parts[0]
  const caseKey = fractionCaseKeys(applied.prompt)[0]
  if (!caseKey) return null
  if (concept.conceptId === 'math.4.nf.a.1') {
    const denominator = Number(applied.prompt.match(/denominator (\d+)/)?.[1]), factor = denominator / b
    if (!Number.isInteger(factor)) return null
    return {
      problem: applied.prompt, answer: `${a * factor}/${denominator}`, caseKey,
      steps: [
        { work: `${denominator} ÷ ${b} = ${factor}`, reason: 'Find how many smaller equal parts replace each original part.' },
        { work: `${a} × ${factor} = ${a * factor}`, reason: 'Split every counted part by the same factor so the amount stays the same.' },
        { work: `${a}/${b} = ${a * factor}/${denominator}`, reason: 'The numerator and denominator changed by the same factor.' },
      ],
      check: `Undo the split: ${a * factor} ÷ ${factor} = ${a} and ${denominator} ÷ ${factor} = ${b}.`,
    }
  }
  const [c, d] = parts[1], unit = sameUnit(b, d), left = a * unit / b, right = c * unit / d
  const renamed = { work: `${a}/${b} = ${left}/${unit}; ${c}/${d} = ${right}/${unit}`, reason: 'Multiplying both parts of each fraction by the same factor preserves its amount.' }
  if (concept.conceptId === 'math.4.nf.a.2') return {
    problem: applied.prompt, answer: a * d >= c * b ? `${a}/${b}` : `${c}/${d}`, caseKey,
    steps: [
      { work: `Use ${unit} equal parts in each whole.`, reason: 'Fractions can only be compared fairly when the wholes have the same size.' },
      renamed,
      { work: `${Math.max(left, right)}/${unit} > ${Math.min(left, right)}/${unit}`, reason: 'With equal-sized parts, more counted parts means a larger amount.' },
    ],
    check: `The unit is the same on both sides; compare ${left} and ${right}, not ${b} and ${d}.`,
  }
  const answer = fractionString(left + right, unit)
  return {
    problem: applied.prompt, answer, caseKey,
    steps: [
      { work: `Use denominator ${unit}.`, reason: `${unit} is a multiple of both ${b} and ${d}, so both amounts can be counted in the same-sized parts.` },
      renamed,
      { work: `${left}/${unit} + ${right}/${unit} = ${left + right}/${unit} = ${answer}`, reason: 'Count the equal-sized parts together, keep their size, then simplify without changing the amount.' },
    ],
    check: `Subtract the second amount: ${answer} − ${c}/${d} = ${fractionString(a, b)}.`,
  }
}

/** A separate example followed by an unfinished problem. The missing move retains its declared demand. */
export function fractionScaffold(concept: ConceptNode, bloom: BloomLevel, seed: number, faded: boolean, excluded = new Set<string>()): Scaffold | null {
  let worked: WorkedExample | null = null, completion: WorkedExample | null = null
  for (let offset = 0; offset < 128; offset++) {
    const candidate = checkedFractionExample(concept, seed + offset * 7919)
    if (!candidate) return null
    if (excluded.has(candidate.caseKey)) continue
    if (!worked) worked = candidate
    else if (candidate.caseKey !== worked.caseKey) { completion = candidate; break }
  }
  if (!worked || !completion) return null
  const level = Math.max(1, bloom) as BloomLevel
  const given = completion.steps.slice(0, faded ? 1 : 2).map(step => step.work).join('\n')
  const partial = `${completion.problem}\nStarted for you:\n${given}`
  const hints = [completion.steps[0].reason, completion.steps[1].reason, `One completed path: ${completion.steps.map(step => step.work).join(' ')} ${completion.check}`]
  const task: Scaffold['task'] = { prompt: '', answer: '', bloom: level, format: 'text', hints }
  if (level === 1) Object.assign(task, {
    prompt: `${partial}\nName the next step in order. You do not need to calculate the final answer.`,
    answer: `Rubric: recall the next step of ${concept.title}: ${completion.steps[faded ? 1 : 2].reason} Accept equivalent words; no final calculation is required.`, format: 'steps',
  })
  else if (level === 2) {
    const correct = completion.steps[1].reason
    const wrong = concept.conceptId === 'math.4.nf.a.2' ? 'A larger denominator always means a larger amount.'
      : concept.conceptId === 'math.4.nf.a.1' ? 'Changing just the denominator always keeps the same amount.' : 'Adding the denominators keeps the size of the parts unchanged.'
    const flip = seed % 2 === 1
    Object.assign(task, { prompt: `${partial}\nFinish the explanation. Which reason makes this step valid?\nA) ${flip ? wrong : correct}\nB) ${flip ? correct : wrong}\nReply A or B.`, answer: flip ? 'B' : 'A', format: 'choice', choices: ['A', 'B'] })
  } else if (level === 3) Object.assign(task, { prompt: `${partial}\nFinish the problem. Write the final fraction.`, answer: completion.answer })
  else if (level === 4) Object.assign(task, {
    prompt: `${partial}\nA learner says: “Changing the denominator alone preserves a fraction.” Finish the error analysis: explain the first invalid move and write a corrected step.`,
    answer: `Rubric: identify changing only the denominator as invalid; explain equal parts and an unchanged amount; give a valid correction for this problem. Relevant checked work: ${completion.steps[1].work}. A final answer alone does not count.`, format: 'text',
  })
  else if (level === 5) Object.assign(task, {
    prompt: `${partial}\nOne learner would change both numerator and denominator by the same factor; another would change only the denominator. Finish judging both plans. Explain which preserves the amount, why, and how you would check it.`,
    answer: `Rubric: judge both plans using equivalent fractions, explain why changing only the denominator changes the amount, and give a valid independent check. Check for this case: ${completion.check} A verdict alone does not count.`, format: 'text',
  })
  else Object.assign(task, {
    prompt: `${partial}\nUse this beginning to create a different problem that teaches ${concept.title}. Choose new fractions. Finish your design with a correct answer and a way to check it.`,
    answer: `Rubric: create a new problem, not a copy of the supplied one, using ${concept.recall}; give a correct solution and a valid check. Accept different numbers and methods when the idea is sound.`, format: 'text',
  })
  return { version: 1, route: concept.conceptId.startsWith('math.4.nf.a.') ? 'conceptual' : 'procedural', worked, task, caseKeys: [worked.caseKey, completion.caseKey] }
}

export function readScaffold(value: unknown): Scaffold | null {
  try {
    if (typeof value !== 'string' || value.length > 16000) return null
    const parsed = JSON.parse(value) as Scaffold
    return parsed.version === 1 && ['conceptual', 'procedural'].includes(parsed.route) && typeof parsed.worked?.problem === 'string'
      && Array.isArray(parsed.worked.steps) && parsed.worked.steps.length === 3 && parsed.worked.steps.every(s => typeof s.work === 'string' && typeof s.reason === 'string')
      && typeof parsed.worked.answer === 'string' && typeof parsed.worked.check === 'string' && Array.isArray(parsed.caseKeys) && parsed.caseKeys.length === 2
      ? parsed : null
  } catch { return null }
}
