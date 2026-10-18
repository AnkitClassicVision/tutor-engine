import assert from 'node:assert/strict'
import test from 'node:test'
import { manipulative, manipulativeFor } from '../src/manipulatives.ts'
import { mathPicture } from '../src/visuals.ts'
import { lessonCard, sessionPage } from '../src/view.ts'

test('each concept gets the model that fits it, started from the numbers in the question', () => {
  assert.equal(manipulativeFor('math.primary.3.fraction'), 'fraction'); assert.equal(manipulativeFor('math.4.nf.a.1'), 'fraction'); assert.equal(manipulativeFor('math.5.nf.a.1'), 'fraction')
  assert.equal(manipulativeFor('math.primary.3.multiply'), 'groups'); assert.equal(manipulativeFor('math.primary.3.divide'), 'groups')
  assert.equal(manipulativeFor('math.primary.2.add'), 'line'); assert.equal(manipulativeFor('math.7.ns.a.1'), 'line')
  assert.equal(manipulativeFor('math.8.ee.a.1'), null); assert.equal(manipulativeFor('science.cells'), null)
  const bar = manipulative('math.4.nf.a.1', 'Is 3/8 equal to 6/16?')
  assert.match(bar, /data-parts="8"/); assert.equal((bar.match(/aria-pressed="true"/g) ?? []).length, 3); assert.match(bar, /3 of 8 equal parts shaded: 3\/8/)
  assert.match(manipulative('math.primary.3.fraction', 'A shape has 6 equal parts. One part is shaded.'), /data-parts="6"/)
  const groups = manipulative('math.primary.3.multiply', '6 baskets hold 7 apples each. How many apples?')
  assert.match(groups, /data-groups="6" data-each="7"/); assert.match(groups, /6 groups of 7 make 42/)
  assert.match(manipulative('math.primary.2.add', 'What is 38 + 15?'), /data-at="38" data-low="0" data-high="60"/)
  assert.match(manipulative('math.7.ns.a.1', 'What is -3 + 8?'), /data-low="-20" data-high="20"/)
  for (const html of [bar, groups]) {
    assert.match(html, /role="group" aria-labelledby="manip-\d+"/); assert.match(html, /aria-live="polite"/)
    assert.ok(!/<(?:div|span)[^>]*onclick/.test(html), 'controls are native buttons')
  }
})

test('pictures no longer draw dots for fraction products or powers', () => {
  assert.equal(mathPicture('Multiply 1/2 × 3/4.'), '')
  assert.equal(mathPicture('Simplify 2^3 × 2^4.'), '')
  assert.match(mathPicture('What is 3 × 4?'), /3 rows of 4 dots/)
})

test('models appear in Show me how and lesson cards, never on an independent question', () => {
  const item = { id: 'item-1', concept_id: 'math.primary.3.multiply', prompt: '6 baskets hold 7 apples each. How many apples?', answer: '42', hints_used: 0, format: 'text' }
  const question = sessionPage({ sessionId: 's', continuity: '', item, position: 2, total: 6, feedback: null, onBreak: false, ended: false, capMinutes: 10 })
  assert.doesNotMatch(question, /data-manip/)
  const miss = sessionPage({ sessionId: 's', continuity: '', item, position: 3, total: 6, onBreak: false, ended: false, capMinutes: 10, feedbackConceptId: 'math.primary.3.multiply',
    feedback: { correct: false, prompt: '5 baskets hold 4 apples each. How many apples?', itemId: 'item-0', corrective: { label: 'Not quite', move: 'Count the groups.', ask: 'How many in each basket?', answer: '20' } } })
  const showHow = miss.slice(miss.indexOf('<details class="show-how">'))
  assert.match(showHow, /data-manip="groups" data-groups="5" data-each="4"/)
  assert.equal((miss.match(/data-manip=/g) ?? []).length, 1, 'only inside Show me how')
  assert.match(lessonCard('s', { conceptId: 'math.primary.3.fraction', title: 'Name equal parts', recall: 'Equal parts have the same size.', example: 'A pizza cut into 4 equal parts' }), /data-manip="fraction" data-parts="4"/)
})
