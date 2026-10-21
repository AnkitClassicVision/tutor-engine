import test from 'node:test'
import assert from 'node:assert/strict'
import { authoredFractionTask, approvedFractionForm, FRACTION_FORM_CASES, FRACTION_OUTCOMES } from '../src/engine/fraction-forms.ts'
import { loadBackbone } from '../src/engine/graph.ts'
import { rubricIssues } from '../src/rubric.ts'
import { taskEvidence, taskMatches } from '../src/task-evidence.ts'
import { fractionCaseKeys } from '../src/engine/scaffolds.ts'

const value = (fraction: string) => { const [n, d = '1'] = fraction.split('/'); return Number(n) / Number(d) }
const delivered = (task: NonNullable<ReturnType<typeof authoredFractionTask>>) => ({
  concept_id: task.conceptId, bloom_level: task.bloom, prompt: task.prompt, answer: task.answer,
  format: task.format, choices_json: task.choices ? JSON.stringify(task.choices) : null,
  rubric_json: task.rubric ? JSON.stringify(task.rubric) : null, evidence_kind: task.role,
})

test('authored fraction outcomes have distinct identities and the declared prerequisite graph', () => {
  const graph = loadBackbone()
  assert.equal(new Set(Object.values(FRACTION_OUTCOMES).map(o => o.id)).size, 5)
  for (const [id, outcome] of Object.entries(FRACTION_OUTCOMES)) assert.deepEqual(graph.nodes.get(id)?.prereqs, outcome.prerequisites)
  assert.ok(FRACTION_FORM_CASES >= 60)
})

test('every authored numeric key and creation example satisfies the mathematical constraints', () => {
  for (let n = 0; n < FRACTION_FORM_CASES; n++) {
    const equivalent = authoredFractionTask('math.4.nf.a.1', 3, n)!
    const parts = equivalent.prompt.match(/Complete (\d+)\/(\d+) = \?\/(\d+)/)!.slice(1).map(Number)
    assert.equal(Number(equivalent.answer) / parts[2], parts[0] / parts[1])
    assert.equal(fractionCaseKeys(equivalent.prompt)[0], 'equivalent:' + parts[0] + '/' + parts[1] + ':' + parts[2])
    for (const id of ['math.4.nf.a.2', 'math.4.nf.b.3', 'math.5.nf.a.1']) {
      const task = authoredFractionTask(id, 3, n)!, values = [...task.prompt.matchAll(/\d+\/\d+/g)].map(m => value(m[0]))
      const expected = id === 'math.4.nf.a.2' ? Math.max(...values) : values[0] + values[1]
      assert.ok(Math.abs(value(task.answer) - expected) < 1e-12, task.prompt)
      if (id === 'math.4.nf.a.2') continue
      const creation = authoredFractionTask(id, 6, n)!, example = creation.rubric!.examples.meets
      const fractions = [...example.matchAll(/\d+\/\d+/g)].map(m => m[0]), pair = fractions.slice(0, 2)
      assert.ok(pair.every(f => value(f) > 0 && value(f) < 1))
      assert.ok(Math.abs(value(pair[0]) + value(pair[1]) - expected) < 1e-12, example)
      assert.notDeepEqual(pair.map(value).sort(), values.sort(), 'creation must not reverse or rename the supplied pair')
      assert.equal(pair[0].split('/')[1] === pair[1].split('/')[1], id === 'math.4.nf.b.3', example)
    }
  }
})

test('analysis, judgment and construction keep specific rubrics; only exact final authored forms earn IDs', () => {
  for (const id of Object.keys(FRACTION_OUTCOMES)) for (const level of [4, 5, 6] as const) {
    const task = authoredFractionTask(id, level, 17)!, row = delivered(task)
    assert.equal(rubricIssues(task.rubric).length, 0)
    assert.ok(task.rubric!.mustShow.length >= 2)
    assert.deepEqual(approvedFractionForm(row), { outcomeId: task.outcomeId, parallelFormId: task.parallelFormId })
    const evidence = taskEvidence(row, 'builtin'), frozen = { ...row, revision_id: evidence.revision, task_evidence: JSON.stringify(evidence) }
    assert.equal(taskMatches(frozen), true)
    for (const changed of [
      { prompt: row.prompt + ' Choose A or B.' }, { answer: 'Rubric: any response.' }, { rubric_json: null },
      { format: 'choice', choices_json: '["A","B"]' }, { evidence_kind: 'transfer' },
    ]) {
      assert.equal(approvedFractionForm({ ...row, ...changed }), null)
      assert.equal(taskMatches({ ...frozen, ...changed }), false)
    }
  }
  const transfer = authoredFractionTask('math.5.nf.a.1', 4, 8, 'transfer')!
  assert.match(transfer.prompt, /storage/)
  assert.match(transfer.rubric!.mustShow[0].point, /capacity/)
  assert.notEqual(transfer.parallelFormId, authoredFractionTask('math.5.nf.a.1', 4, 8)!.parallelFormId)
  assert.equal(authoredFractionTask('math.5.nf.a.1', 3, 8, 'transfer'), null, 'an unfamiliar setting does not silently relabel a calculation as analysis')
})
