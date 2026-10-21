import { fractionString } from './score.ts'
import type { BloomLevel } from './types.ts'
import type { Rubric } from '../rubric.ts'

export const FRACTION_OPERATION = 'math.fractions.operation-choice'
/** Authored scope, not a claim of empirically equated difficulty or learner mastery. */
export const FRACTION_OUTCOMES = {
  'math.4.nf.a.1': { id: 'fractions.equivalence.v1', title: 'Keep a fraction amount unchanged', prerequisites: [] },
  'math.4.nf.a.2': { id: 'fractions.magnitude.v1', title: 'Compare amounts using the same whole', prerequisites: ['math.4.nf.a.1'] },
  'math.4.nf.b.3': { id: 'fractions.like-addition.v1', title: 'Combine equal-sized fractional parts', prerequisites: ['math.4.nf.a.1'] },
  'math.5.nf.a.1': { id: 'fractions.unlike-addition.v1', title: 'Add proper fractions after one renaming', prerequisites: ['math.4.nf.a.1', 'math.4.nf.b.3'] },
  [FRACTION_OPERATION]: { id: 'fractions.operation-choice.v1', title: 'Choose addition or subtraction from a quantity relationship', prerequisites: ['math.4.nf.a.2', 'math.5.nf.a.1'] },
} as const

export interface FractionTask {
  conceptId: string
  bloom: BloomLevel
  role: 'practice' | 'transfer'
  prompt: string
  answer: string
  format: 'text' | 'choice' | 'steps'
  choices?: string[]
  rubric?: Rubric
  hints: [string, string, string]
  outcomeId: string
  parallelFormId: string
}
interface Case { a: number; b: number; c: number; d: number }
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a
const cases: Case[] = []
// Reduced, positive proper fractions, denominator factor two, sum below one.
// Every calculation requires exactly one renaming. No mixed numbers or carrying.
for (let b = 4; b <= 12; b++) for (let a = 1; a < b; a++) for (let c = 1; c < 2 * b - 2 * a; c += 2) {
  if (gcd(a, b) === 1 && gcd(c, 2 * b) === 1) cases.push({ a, b, c, d: 2 * b })
}
export const FRACTION_FORM_CASES = cases.length
const outcome = (id: string) => FRACTION_OUTCOMES[id as keyof typeof FRACTION_OUTCOMES]
const fraction = (n: number, d: number) => n + '/' + d
function newAdditionPair(q: Case, like: boolean): string[] {
  const numerator = 2 * q.a + q.c
  if (like) return [fraction(numerator, 4 * q.d), fraction(3 * numerator, 4 * q.d)]
  const original = [fractionString(q.a, q.b), fractionString(q.c, q.d)].sort().join(':')
  for (let denominator = 2; denominator <= 4 * q.d; denominator++) for (let n = 1; n < denominator; n++) {
    const rest = numerator * denominator - n * q.d
    if (rest <= 0) continue
    const pair = [fractionString(n, denominator), fractionString(rest, q.d * denominator)]
    if (pair[0].split('/')[1] !== pair[1].split('/')[1] && [...pair].sort().join(':') !== original) return pair
  }
  throw new Error('Authored creation example has no valid pair.')
}
function rubric(points: Array<[string, string, string]>, meets: string, almost: string, notYet: string): Rubric {
  return {
    mustShow: points.map(([point, a, b]) => ({ point, acceptable: [a, b] })),
    doesNotMeet: ['A verdict or final number without the requested reasoning.', notYet],
    notRequired: ['Exact wording or full sentences.', 'Spelling and grammar.', 'A particular valid method unless the question asks for it.'],
    examples: { meets, almost, notYet },
  }
}

/** Bounded templates vary quantities within a declared stratum; instructions and rubrics retain their demand. */
export function authoredFractionTask(conceptId: string, bloom: BloomLevel, seed: number, role: 'practice' | 'transfer' = 'practice'): FractionTask | null {
  const approved = outcome(conceptId)
  if (!approved || bloom < 3 || bloom > 6 || role === 'transfer' && bloom !== 4) return null
  const q = cases[Math.abs(Math.trunc(seed)) % cases.length]
  const { a, b, c, d } = q, left = fraction(a, b), right = fraction(c, d), renamed = fraction(a * 2, d)
  const sum = fractionString(2 * a + c, d), wrongSum = fraction(a + c, b + d)
  const total = fraction(2 * a + c, d), difference = fractionString(2 * a, d)
  const task: FractionTask = {
    conceptId, bloom, role, prompt: '', answer: '', format: 'text',
    hints: ['What quantity is the question asking about?', 'Explain one relationship between the amounts.', 'Compare with the key: '],
    outcomeId: approved.id,
    parallelFormId: approved.id + ':b' + bloom + ':' + role + ':proper-factor2-below-one-v1',
  }
  const reasoning = (prompt: string, points: Array<[string, string, string]>, meets: string, almost: string, notYet: string) => {
    task.prompt = prompt; task.rubric = rubric(points, meets, almost, notYet)
    task.answer = 'Rubric: ' + points.map(p => p[0]).join(' ') + ' One valid response: ' + meets
  }
  if (conceptId === 'math.4.nf.a.1') {
    if (bloom === 3) {
      task.prompt = 'Complete ' + left + ' = ?/' + d + '. Write the missing numerator only.'
      task.answer = String(2 * a)
    } else if (bloom === 4) reasoning(
      'A learner writes ' + left + ' = ' + fraction(a, d) + '. Identify the change that broke the equality, explain why, and correct it.',
      [['Identify the unchanged numerator when the denominator doubled.', 'Only the bottom doubled.', 'Each part became half as big but the count stayed the same.'],
        ['Correct the fraction and explain how the amount stays unchanged.', renamed + '; double both numbers.', 'Split every original part in two and count twice as many parts.']],
      'Only the bottom doubled, so the amount halved. ' + left + ' = ' + renamed + ' because both counts double.', renamed, 'Changing only the denominator keeps the amount.')
    else if (bloom === 5) reasoning(
      'Two proposals for a fraction equal to ' + left + ': A multiplies both numbers by 2 to get ' + renamed + '; B adds ' + b + ' to both numbers to get ' + fraction(a + b, d) + '. Judge both, explain your reason, and give a check.',
      [['Judge A as valid and B as invalid, with a reason.', 'Scaling both counts preserves the ratio; adding does not.', 'A splits each part equally; B adds a different amount.'],
        ['Supply a valid check of the judgment.', 'Halve both numbers in A and recover ' + left + '.', 'Compare the two amounts on equal-sized wholes.']],
      'A keeps the amount: halving both numbers gives ' + left + '. B changes it because adding the same number changes this proper fraction toward one.', 'A is right.', 'Both are right because the top and bottom change.')
    else reasoning(
      'Create two different fractions equal to ' + left + '. Use denominators larger than ' + d + '. Explain how you made them and show a check.',
      [['Create two different equivalent fractions with denominators greater than the limit.', fraction(a * 3, b * 3) + ' and ' + fraction(a * 4, b * 4), 'Any two different valid whole-number multiples meeting the limit.'],
        ['Explain the construction and verify the equal amounts.', 'Multiply both counts by the same factor and undo it.', 'Split every part equally and check both ratios.']],
      fraction(a * 3, b * 3) + ' and ' + fraction(a * 4, b * 4) + '; I scaled both counts by 3 and 4. Dividing each pair by its factor returns ' + left + '.', renamed, 'I change only the denominators.')
  } else if (conceptId === 'math.4.nf.a.2') {
    const larger = 2 * a > c ? left : right, sign = 2 * a > c ? '>' : '<'
    if (bloom === 3) { task.prompt = 'Which is greater, ' + left + ' or ' + right + '? Both refer to the same whole. Reply with the fraction.'; task.answer = larger }
    else if (bloom === 4) reasoning(
      'Compare ' + left + ' and ' + right + ' of the same whole. A learner compares only ' + b + ' and ' + d + ' and says the larger denominator proves the larger amount. Identify what that reasoning leaves out and give a valid comparison.',
      [['Explain why denominators alone cannot decide this comparison.', 'The numbers of parts also matter.', 'The denominator tells part size, not the whole amount counted.'],
        ['Give the correct comparison with valid evidence.', renamed + ' ' + sign + ' ' + right, 'A correct equal-whole drawing or cross-product comparison.']],
      'The part counts also matter. ' + left + ' = ' + renamed + ', so ' + renamed + ' ' + sign + ' ' + right + '.', larger, 'The bigger denominator always gives more.')
    else if (bloom === 5) reasoning(
      'For ' + left + ' and ' + right + ' of the same whole, A compares the numerators after renaming to denominator ' + d + '. B compares the denominators alone. Judge both methods, justify your judgment and check the result.',
      [['Evaluate both methods using the size and count of equal parts.', 'A is valid because the parts match; B ignores the counts.', 'Equal-sized parts make a numerator comparison meaningful.'],
        ['Verify the comparison.', renamed + ' ' + sign + ' ' + right, 'A correct same-whole diagram or cross products.']],
      'A compares equal-sized parts. B ignores how many parts are counted. ' + renamed + ' ' + sign + ' ' + right + ' checks the result.', 'Use A.', 'B works because the denominators are different.')
    else reasoning(
      'Create one fraction smaller than ' + left + ' and one larger than it. All three must be between 0 and 1. Use denominators different from ' + b + ' and justify both comparisons.',
      [['Construct both fractions within the stated constraints.', fraction(a, 2 * b) + ' and ' + fraction(a + b, 2 * b), 'Any correct pair with different denominators and amounts between zero and one.'],
        ['Justify both comparisons using the same whole.', 'Rename to a common denominator and compare counts.', 'Give a correctly labeled same-whole diagram.']],
      fraction(a, 2 * b) + ' < ' + renamed + ' < ' + fraction(a + b, 2 * b) + '. The common-sized parts show the order; both new amounts are proper fractions.', fraction(a, 2 * b), 'I chose a larger denominator so the fraction must be larger.')
  } else if (conceptId === 'math.4.nf.b.3' || conceptId === 'math.5.nf.a.1') {
    const like = conceptId === 'math.4.nf.b.3', first = like ? renamed : left
    const equation = first + ' + ' + right, wrong = like ? fraction(2 * a + c, 2 * d) : wrongSum
    task.parallelFormId = approved.id + ':b' + bloom + ':' + role + ':' + (like ? 'same-unit' : 'one-renaming') + '-proper-below-one-v1'
    if (bloom === 3) { task.prompt = 'Add ' + equation + '.'; task.answer = sum }
    else if (bloom === 4) reasoning(
      'Add ' + equation + '.\nStep 1: ' + first + ' = ' + renamed + '.\nStep 2: ' + renamed + ' + ' + right + ' = ' + fraction(2 * a + c, 2 * d) + '.\nFind the first wrong step, explain the error, and correct that step.',
      [['Identify step 2 and explain why the unit must stay unchanged.', 'Step 2 doubles the denominator even though the parts already match.', 'Adding the counts does not change the size of each part.'],
        ['Correct the calculation.', renamed + ' + ' + right + ' = ' + total + ' = ' + sum, 'Any equivalent correct sum with an explanation of equal-sized parts.']],
      'Step 2 is wrong: the parts already have size 1/' + d + ', so keep ' + d + '. The sum is ' + sum + '.', sum, 'Add both denominators.')
    else if (bloom === 5) reasoning(
      'For ' + equation + ', A uses equal-sized parts and gets ' + sum + '. B adds the top and bottom numbers separately and gets ' + wrong + '. Judge both methods, justify your judgment and give a check.',
      [['Judge A as valid and B as invalid with a unit-based reason.', 'A combines matching parts; B changes their size.', 'The sum counts parts of a common whole, not newly sized parts.'],
        ['Give a valid check independent of repeating the claim.', sum + ' minus ' + right + ' equals ' + first + '.', 'A correct common-unit diagram or subtraction check.']],
      'A keeps matching parts; B changes their size. Taking away ' + right + ' from ' + sum + ' gives ' + first + '.', 'A is right.', 'B is right because both numbers should be added.')
    else reasoning(
      'Create a different addition problem with two positive proper fractions whose sum is ' + sum + '. ' + (like ? 'Use the same denominator in your pair.' : 'Use different denominators in your pair.') + ' Do not reuse the pair ' + equation + '. Give the answer and verify it.',
      [['Construct a new pair meeting the denominator, positivity and sum constraints.', 'Any different valid pair whose sum is ' + sum + '.', 'An equivalent notation alone or reversing the supplied pair is not new.'],
        ['Verify the constructed sum.', 'Rename to equal parts and add.', 'Subtract either addend from the total to recover the other.']],
      newAdditionPair(q, like).join(' + ') + ' = ' + sum + '. Renaming and adding verifies the total.',
      'I use the supplied pair.', 'Any pair of fractions works.')
  } else {
    const story = 'A container holds ' + total + ' litre. ' + right + ' litre is poured out. How much remains?'
    const valid = total + ' − ' + right + ' = ' + difference
    if (bloom === 3) reasoning(
      story + ' Write an equation, solve it, and explain why you chose that operation.',
      [['Choose subtraction to represent the amount remaining.', 'Subtract what was removed from the starting amount.', 'The part left and the part removed make the starting amount.'],
        ['Solve the equation correctly.', valid, 'Any equivalent correct subtraction equation.']],
      valid + '. It asks for what is left after some is removed.', difference, 'Add the amount poured out.')
    else if (bloom === 4) reasoning(
      'Story A: a container starts with ' + left + ' litre and receives ' + right + ' litre. Story B: it starts with ' + total + ' litre and loses ' + right + ' litre. Write an equation for each and explain why the operations differ.',
      [['Represent combining and removing with the appropriate equations.', left + ' + ' + right + ' = ' + sum + '; ' + valid, 'Equivalent equations that correctly model both stories.'],
        ['Explain the difference in quantity relationships.', 'A combines two parts; B removes a part from a whole.', 'The requested total increases in A and the remainder decreases in B.']],
      left + ' + ' + right + ' = ' + sum + '; ' + valid + '. A joins two parts; B asks for the part left.', 'Add in A and subtract in B.', 'Always add because both stories have two fractions.')
    else if (bloom === 5) reasoning(
      story + ' A learner says to add because the story mentions two amounts. Another says to subtract because some is removed. Judge both explanations and check your equation.',
      [['Evaluate both explanations using the relationship, not a keyword.', 'The second accounts for removal; the first ignores what is asked.', 'Two amounts do not by themselves tell us which operation fits.'],
        ['Provide and check a correct equation.', valid + '; add the remainder and removed amount to recover the start.', 'A correct part-whole drawing with both quantities.']],
      'The second is valid because the amount decreases. ' + valid + '. The remainder plus ' + right + ' returns ' + total + '.', 'Use subtraction.', 'Add whenever two numbers appear.')
    else reasoning(
      'Create two short situations using ' + left + ' and ' + right + '. One must require addition and the other subtraction. Ask a clear question in each, give both answers, and explain what makes the operations different.',
      [['Create two situations whose questions really require different operations.', 'Combine two measured parts; then remove one measured amount from another.', 'Any coherent positive-quantity situations using the two fractions.'],
        ['Answer both and explain the relationships.', 'Addition finds the combined amount; subtraction finds a remainder or difference.', 'Correct equations tied to each created question.']],
      'Join ' + left + ' and ' + right + ' litres: total ' + sum + '. Compare the two amounts: their difference is ' + fractionString(Math.abs(2 * a - c), d) + ' litre. Joining adds; finding a difference subtracts.',
      'Here are two addition stories.', 'Changing a name changes addition into subtraction.')
  }
  if (role === 'transfer') {
    // The unfamiliar setting changes representation and asks for reasoning, never just a new name on the drill.
    if (conceptId !== 'math.5.nf.a.1' && conceptId !== FRACTION_OPERATION) return null
    const space = fractionString(d - 2 * a, d), remaining = fractionString(d - 2 * a - c, d)
    reasoning(
      'A sensor has one unit of storage. A map uses ' + left + ' of that storage. A sound sample needs ' + right + ' of the same storage. Can both be kept together? Explain your decision with an equation and say how much space remains.',
      [['Model the shared capacity and compare the combined use with one whole.', left + ' + ' + right + ' = ' + sum + ' < 1.', 'Compare the sample with the unused capacity ' + space + '.'],
        ['Explain the capacity decision and calculate the unused space.', 'Both fit; unused storage is ' + remaining + '.', 'Any equivalent valid capacity argument and remaining fraction.']],
      'Both fit because ' + left + ' + ' + right + ' = ' + sum + ' < 1. The space remaining is ' + remaining + '.',
      'Both fit.', 'The denominators add to show how much storage is used.')
    task.parallelFormId = approved.id + ':b4:transfer:capacity-one-renaming-v1'
  }
  task.hints[2] += task.answer
  return task
}

type Delivered = { concept_id?: unknown; bloom_level?: unknown; prompt?: unknown; answer?: unknown; format?: unknown; choices_json?: unknown; rubric_json?: unknown; evidence_kind?: unknown }
const signature = (row: Delivered) => JSON.stringify([row.concept_id, Number(row.bloom_level), row.prompt, row.answer, row.format ?? 'text', row.choices_json ?? null, row.rubric_json ?? null, row.evidence_kind === 'transfer' ? 'transfer' : 'practice'])
let registry: Map<string, Pick<FractionTask, 'outcomeId' | 'parallelFormId'>> | undefined
/** Approval belongs to exact authored content. A model-provided ID, edited key or different rubric cannot opt in. */
export function approvedFractionForm(row: Delivered) {
  if (!outcome(String(row.concept_id)) || Number(row.bloom_level) < 3) return null
  if (!registry) {
    registry = new Map()
    for (const id of Object.keys(FRACTION_OUTCOMES)) for (const level of [3, 4, 5, 6] as BloomLevel[]) for (const role of ['practice', 'transfer'] as const) for (let i = 0; i < cases.length; i++) {
      const task = authoredFractionTask(id, level, i, role)
      if (task) registry.set(signature({ concept_id: id, bloom_level: level, prompt: task.prompt, answer: task.answer, format: task.format, choices_json: task.choices ? JSON.stringify(task.choices) : null, rubric_json: task.rubric ? JSON.stringify(task.rubric) : null, evidence_kind: role }), { outcomeId: task.outcomeId, parallelFormId: task.parallelFormId })
    }
  }
  return registry.get(signature(row)) ?? null
}
