/** Paper conditions are reported by the family, never certified by a camera or an upload. */
export interface PaperConditions {
  version: 1
  basis: 'self-reported'
  help: 'none' | 'content' | 'unknown'
  confirmed: boolean
}
export interface PaperWork {
  version: 1
  photos: Array<{ id: string; hash: string }>
  completedReportedAt: string | null
  submittedAt: string | null
  conditions: PaperConditions | null
}
export const newPaperWork = (): PaperWork => ({ version: 1, photos: [], completedReportedAt: null, submittedAt: null, conditions: null })
export function readPaperConditions(value: unknown): PaperConditions | undefined {
  const v = value as Partial<PaperConditions> | undefined
  return v?.version === 1 && v.basis === 'self-reported' && ['none', 'content', 'unknown'].includes(String(v.help)) && typeof v.confirmed === 'boolean'
    ? { version: 1, basis: 'self-reported', help: v.help!, confirmed: v.confirmed } : undefined
}
export function readPaperWork(value: unknown): PaperWork | undefined {
  const v = value as Partial<PaperWork> | undefined
  if (v?.version !== 1 || !Array.isArray(v.photos) || v.photos.length > 12
    || !v.photos.every(p => p && /^[0-9a-f-]{36}$/i.test(p.id) && /^[a-f0-9]{64}$/.test(p.hash))) return undefined
  const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
  return { version: 1, photos: v.photos.map(p => ({ id: p.id, hash: p.hash })), completedReportedAt: date(v.completedReportedAt),
    submittedAt: date(v.submittedAt), conditions: readPaperConditions(v.conditions) ?? null }
}
