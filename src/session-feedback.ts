export type FeedbackItem = { id?: unknown; answered?: unknown; correct?: unknown; hints_used?: unknown; concept_id?: unknown; prompt?: unknown; answer?: unknown; given_answer?: unknown; grading_reason?: unknown }

export function feedbackState(mode: string, items: FeedbackItem[], cursor: number) {
  const answered = items.filter(i => i.answered === 1)
  const current = items.some(i => i.answered === 0)
  const last = answered.at(-1)
  if (!last || (mode === 'assessment' && current)) return { timing:'none' as const, checkpoint:false, entries:[], count:answered.length }
  if (last.correct == null) return { timing:'pending' as const, checkpoint:false, entries:[last], count:answered.length }
  if (mode === 'homework') return { timing:'immediate' as const, checkpoint:false, entries:[last], count:answered.length }
  if (mode === 'session' && (last.correct === 0 || Number(last.hints_used) > 0 || answered.length <= 2)) {
    return { timing:'immediate' as const, checkpoint:current && last.correct === 0 && answered.length > cursor, entries:answered.slice(cursor).length ? answered.slice(cursor) : [last], count:answered.length }
  }
  const batch=answered.slice(cursor)
  return { timing:batch.length >= 3 || !current ? 'batch' as const : 'waiting' as const, checkpoint:current && batch.length >= 3, entries:batch.length >= 3 || !current ? batch : [], count:answered.length }
}

export function promptIdentity(prompt: string) { return prompt.trim().toLowerCase().replace(/\s+/g,' ') }
