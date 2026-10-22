import { learningNow } from './learning-clock.ts'
// How learning is going (panel round 2, item 7). Each measure is computed here from recorded
// sessions, questions and attempts, states its definition, and says "not enough yet" until it
// rests on enough events. Nothing is sent anywhere; parents see it on the numbers page.
import type { Database as DatabaseSync } from './database.ts'
import { freshEvidence, independent } from './engine/mastery.ts'
import { loadAttempts } from './services.ts'
import { retentionPairs, independentConfidence } from './engine/evidence.ts'

export interface Measure { key: string; label: string; value: string; detail: string; definition: string; enough: boolean }

const MIN = 5
const percent = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 }
const duration = (seconds: number) => seconds < 90 ? `${Math.round(seconds)} seconds` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
const notYet = (have: number, need: number, unit: string) => `Not enough yet: ${have} of ${need} ${unit}`
// Guided and faded questions start with a planned hint, so they are not the child's own choices.
const planned = (beat: unknown) => beat === 'guided' || beat === 'faded'

export async function learningMeasures(db: DatabaseSync, studentId: string, now = learningNow()): Promise<Measure[]> {
  const since = new Date(now.getTime() - 30 * 86400000).toISOString()
  const sessions = (await db.prepare(`SELECT id, started_at, requested_at, ended_at, end_reason, paused_at FROM tutor_sessions
    WHERE student_id = ? AND started_at >= ? AND coalesce(goal, '') NOT LIKE 'waiting_review:%' ORDER BY started_at`).all(studentId, since)) as Array<Record<string, any>>
  const items = (await db.prepare(`SELECT i.session_id, i.position, i.concept_id, i.answered, i.skipped, i.correct, i.hints_used, i.beat, i.shown_at, i.visible_at,
    i.submitted_at, i.answer_saved_at, i.submit_to_save_ms, i.active_work_ms, i.grading_started_at, i.grading_finished_at, i.graded_at, i.feedback_visible_at
    FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id
    WHERE s.student_id = ? AND s.started_at >= ? AND coalesce(s.goal, '') NOT LIKE 'waiting_review:%' ORDER BY i.session_id, i.position`).all(studentId, since)) as Array<Record<string, any>>
  const bySession = new Map<string, Array<Record<string, any>>>()
  for (const item of items) bySession.set(String(item.session_id), [...(bySession.get(String(item.session_id)) ?? []), item])
  const measures: Measure[] = []

  // 1. Time to first question.
  const waits = sessions.flatMap((s) => {
    // The question on screen in the browser where recorded; the server's page time for older missions.
    const first = (bySession.get(String(s.id)) ?? []).find((i) => !i.skipped && (i.visible_at || i.shown_at))
    // Measured from the original start where it is kept: a pause after the first question cannot shrink the wait.
    const wait = first ? (Date.parse(String(first.visible_at || first.shown_at)) - Date.parse(String(s.requested_at || s.started_at))) / 1000 : NaN
    return Number.isFinite(wait) && wait >= 0 ? [wait] : []
  })
  measures.push({ key: 'time_to_first', label: 'Time to the first question', enough: waits.length >= MIN,
    value: waits.length >= MIN ? duration(median(waits)) : notYet(waits.length, MIN, 'missions'),
    detail: waits.length >= MIN ? `Middle value over ${waits.length} missions in the last 30 days.` : '',
    definition: 'From pressing start to the first question on screen, including any lesson card. A mission paused before its first question counts the time away.' })

  // Recorded transitions only. Historical, native-form and interrupted observations may be missing.
  // Browser foreground time is an estimate of time available for work, not a measurement of thought.
  const answered = items.filter(i => Number(i.answered) && !Number(i.skipped))
  const between = (end: unknown, start: unknown) => end && start ? Date.parse(String(end)) - Date.parse(String(start)) : null
  const timings = [
    { key: 'submit_to_save', label: 'Wait for a saved answer', value: (i: Record<string, any>) => i.submit_to_save_ms,
      definition: 'Browser time from the first save attempt to acknowledgment of the stored answer, including retries. Separate from checking and work time; missing browser receipts are excluded.' },
    { key: 'save_processing', label: 'Server save processing', value: (i: Record<string, any>) => between(i.answer_saved_at, i.submitted_at),
      definition: 'From accepting the answer to recording that its transaction committed. Excludes the browser connection and later checking; this is not the child’s perceived wait.' },
    { key: 'checking_queue', label: 'Wait before checking', value: (i: Record<string, any>) => between(i.grading_started_at, i.answer_saved_at),
      definition: 'From the stored answer to the latest checker run starting. Includes queued time and any retry delay; answers without a checker run are excluded.' },
    { key: 'checker_run', label: 'Time in the checker', value: (i: Record<string, any>) => between(i.grading_finished_at, i.grading_started_at),
      definition: 'The latest completed checker run, including grounding and failed checks. Separate from queued time. An unfinished run has no duration sample.' },
    { key: 'feedback_wait', label: 'Wait to see checked feedback', value: (i: Record<string, any>) => between(i.feedback_visible_at, i.graded_at),
      definition: 'From the confirmed grade to feedback first displayed in a visible browser tab. Includes time spent away and any intentional whole-assessment hold; it is not model latency.' },
    { key: 'foreground_work', label: 'Time with the question open', value: (i: Record<string, any>) => i.active_work_ms,
      definition: 'Browser estimate before submitting, excluding hidden-tab, paused and save-request time. May include reading or idle time; it does not measure thinking. Missing observations are excluded.' },
  ]
  for (const timing of timings) {
    const samples = answered.map(timing.value).filter((ms): ms is number => typeof ms === 'number' && Number.isFinite(ms) && ms >= 0)
    measures.push({ key: timing.key, label: timing.label, enough: samples.length >= MIN,
      value: samples.length >= MIN ? duration(median(samples) / 1000) : notYet(samples.length, MIN, 'recorded turns'),
      detail: `${samples.length} of ${answered.length} submitted answers have this observation in the last 30 days; ${answered.length - samples.length} are missing or do not apply.`,
      definition: timing.definition })
  }

  // 2. Self-correction after a miss.
  let chances = 0, corrected = 0
  for (const rows of bySession.values()) {
    const answered = rows.filter((i) => i.answered === 1 && i.correct != null)
    answered.forEach((item, index) => {
      if (item.correct !== 0) return
      const next = answered.slice(index + 1).find((i) => i.concept_id === item.concept_id)
      if (!next) return
      chances++
      if (next.correct === 1 && !Number(next.hints_used)) corrected++
    })
  }
  measures.push({ key: 'self_correction', label: 'Gets it right on the next try', enough: chances >= MIN,
    value: chances >= MIN ? percent(corrected, chances) : notYet(chances, MIN, 'misses followed by another try'),
    detail: chances >= MIN ? `${corrected} of ${chances} misses were followed by a correct answer without a hint.` : '',
    definition: 'After a wrong answer, the next question on the same topic in that mission answered correctly with no hint.' })

  // 3. Hints before answering.
  const own = items.filter((i) => i.answered === 1 && !planned(i.beat))
  const hinted = own.filter((i) => Number(i.hints_used) > 0).length
  measures.push({ key: 'hint_before_answer', label: 'Asks for a hint before answering', enough: own.length >= MIN * 2,
    value: own.length >= MIN * 2 ? percent(hinted, own.length) : notYet(own.length, MIN * 2, 'answers'),
    detail: own.length >= MIN * 2 ? `${hinted} of ${own.length} answers came after asking for a hint.` : '',
    definition: 'Answers given after the child asked for a hint. Planned help in guided and faded questions is not counted.' })

  // 4. Missions finished. A mission carried on later is counted once, where it finished.
  const recent = now.getTime() - 2 * 3600000
  const finishedOrOver = sessions.filter((s) => s.end_reason !== 'continued' && (bySession.get(String(s.id)) ?? []).length && (s.ended_at || (!s.paused_at && Date.parse(String(s.started_at)) < recent)))
  const complete = finishedOrOver.filter((s) => !(bySession.get(String(s.id)) ?? []).some((i) => i.answered === 0 && !i.skipped)).length
  measures.push({ key: 'completion', label: 'Missions finished', enough: finishedOrOver.length >= MIN,
    value: finishedOrOver.length >= MIN ? percent(complete, finishedOrOver.length) : notYet(finishedOrOver.length, MIN, 'missions'),
    detail: finishedOrOver.length >= MIN ? `${complete} of ${finishedOrOver.length} missions in the last 30 days reached the end.` : '',
    definition: 'Missions where every question was answered. A paused mission is not judged until it ends, a mission carried on later counts once, and an open mission is judged after two hours.' })

  // 5. Comparable later independent checks. Exposure history is a separate claim.
  const attempts = await loadAttempts(db, studentId)
  const comparisons = retentionPairs(attempts)
  const pairs = comparisons.length, held = comparisons.filter(pair => pair.after.correct).length
  const validated = comparisons.filter(pair => pair.comparison === 'validated').length
  const unrefreshed = comparisons.filter(pair => pair.unrefreshed).length
  measures.push({ key: 'retention', label: 'Comparable later checks', enough: pairs >= MIN,
    value: pairs >= MIN ? percent(held, pairs) : notYet(pairs, MIN, 'topics with comparable later checks'),
    detail: pairs >= MIN ? `${held} of ${pairs} topics were right on a comparable later unaided check. ${validated} validated form matches; ${pairs - validated} historical proxies. ${unrefreshed} have a recorded gap without in-app refresher practice.` : '',
    definition: 'The latest fresh unaided check of each topic paired with its most recent comparable prior success at least seven days earlier. Demand and task role must match; known response-form conflicts are excluded. Historical proxies and incomplete exposure history cannot prove a week without refresher practice.' })

  // 6. Knows what they know: answers marked "Sure" that were right, beside guesses that were right.
  const rated = freshEvidence(attempts).filter(a => independentConfidence(a) && a.day >= since.slice(0, 10))
  const sure = rated.filter((a) => a.confidence === 'sure'), guesses = rated.filter((a) => a.confidence === 'guess')
  const sureRight = sure.filter((a) => a.correct).length, guessRight = guesses.filter((a) => a.correct).length
  const expressed = attempts.filter(a => a.confidence && a.day >= since.slice(0, 10)).length
  const excludedConfidence = expressed - rated.length
  measures.push({ key: 'calibration', label: 'Confidence on independent answers', enough: sure.length >= MIN,
    value: sure.length >= MIN ? `${percent(sureRight, sure.length)} of “sure” answers right` : notYet(sure.length, MIN, 'answers marked “sure”'),
    detail: (sure.length >= MIN ? `${sureRight} of ${sure.length} “sure” answers were right${guesses.length ? `; ${guessRight} of ${guesses.length} guesses were right` : ''}. ` : '')
      + (excludedConfidence ? `${excludedConfidence} rated responses are excluded because help, freshness, confirmation or capture order does not meet the independent conditions.` : ''),
    definition: 'Fresh, confirmed, unaided answers with confidence captured before submission on the same question revision, over the last 30 days. Help before the answer disqualifies the response; unknown historical capture order is excluded.' })
  return measures
}
