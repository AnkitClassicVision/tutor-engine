/** Reads a test or birthday date from everyday words: 2026-10-23, "Oct 23", "23 October", "Friday", "next Tuesday", "tomorrow". */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
export function findDate(text: string, today: string): string | null {
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (iso) return iso[1]
  const base = new Date(`${today}T12:00:00Z`)
  const named = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i) ?? text.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i)
  if (named) {
    const monthWord = /^\d/.test(named[1]) ? named[2] : named[1], dayWord = /^\d/.test(named[1]) ? named[1] : named[2]
    const month = MONTHS.indexOf(monthWord.slice(0, 3).toLowerCase()), day = Number(dayWord)
    let year = base.getUTCFullYear()
    if (month < base.getUTCMonth() || (month === base.getUTCMonth() && day < base.getUTCDate())) year++
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  }
  const weekday = text.match(/\b(?:next\s+|this\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
  if (weekday) {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    const target = days.indexOf(weekday[1].toLowerCase())
    let ahead = (target - base.getUTCDay() + 7) % 7
    if (ahead === 0 || /\bnext\b/i.test(weekday[0])) ahead = ahead === 0 ? 7 : ahead
    base.setUTCDate(base.getUTCDate() + ahead)
    return base.toISOString().slice(0, 10)
  }
  if (/\btomorrow\b/i.test(text)) { base.setUTCDate(base.getUTCDate() + 1); return base.toISOString().slice(0, 10) }
  return null
}

