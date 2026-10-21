import test from 'node:test'
import assert from 'node:assert/strict'
import { learningRouteFixture, FRACTION_TARGET } from './fixtures/learning-routes.ts'
import { nextLearningAction } from '../src/services.ts'
import { learningNow, withLearningClock } from '../src/learning-clock.ts'

test('the injectable learning clock is request-local and drives selection, sources, exposure and pause timing', async () => {
  const f = await learningRouteFixture(), other = await learningRouteFixture()
  try {
    const home = '/students/' + f.student
    assert.match(await (await f.request(home)).text(), /data-learning-day="2026-10-05"/)
    assert.match(await f.source(), /Synthetic school coverage/)
    const started = await f.request(home + '/session', { mode: 'assessment', goal: 'diagnostic_check', focusConceptId: FRACTION_TARGET })
    assert.equal(started.status, 303)
    const path = started.headers.get('location')!, session = path.split('/').at(-1)!, items = await f.items(session)
    assert.equal(items.length, 6)
    await f.request(path)
    f.advance(2000)
    await f.request(path + '/seen', { itemId: items[0].id, what: 'question' })
    const visible = (await f.items(session))[0]
    assert.equal(visible.visible_at, f.now())
    assert.equal((await f.db.prepare('SELECT at FROM learning_exposures WHERE item_id = ? AND kind = ? AND confirmed = 1 ORDER BY at DESC LIMIT 1').get(items[0].id, 'question'))?.at, f.now())
    await f.request(path + '/pause', {})
    f.advance(120000)
    const beforeResume = f.now()
    await f.request(path + '/resume', {})
    const row = await f.db.prepare('SELECT * FROM tutor_sessions WHERE id = ?').get(session)
    assert.equal(row?.paused_ms, 120000)
    assert.equal(row?.started_at, '2026-10-05T12:02:00.000Z')
    const html = await (await f.request(path)).text()
    assert.ok(html.includes('data-session-now="' + beforeResume + '"'))
    await f.request(path + '/finish', {})
    f.advance(7 * 86400000)
    assert.match(await (await f.request(home)).text(), /data-learning-day="2026-10-12"/)
    assert.doesNotMatch(await f.source(), /Synthetic school coverage/, 'dated source window must use server learning time')
    assert.equal((await f.within(() => nextLearningAction(f.db, f.owner, f.student)))?.checkGoal, 'diagnostic_check', 'unanswered work does not become prerequisite evidence')
    assert.match(await (await other.request('/students/' + other.student)).text(), /data-learning-day="2026-10-05"/)
    assert.ok(Math.abs(learningNow().getTime() - Date.now()) < 1000, 'no global Date replacement')
    const wall = Date.now()
    await Promise.all([withLearningClock(() => new Date('2030-01-01'), async () => {
      await Promise.resolve(); assert.equal(learningNow().getUTCFullYear(), 2030)
    }), Promise.resolve().then(() => assert.ok(Math.abs(learningNow().getTime() - wall) < 1000))])
  } finally { await f.close(); await other.close() }
})
