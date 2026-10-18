export function dayStamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function addDays(day: string, count: number): string {
  const [year, month, date] = day.split("-").map(Number)
  const utc = new Date(Date.UTC(year, month - 1, date))
  utc.setUTCDate(utc.getUTCDate() + count)
  return utc.toISOString().slice(0, 10)
}

export function daysBetween(earlier: string, later: string): number {
  const [y1, m1, d1] = earlier.split("-").map(Number)
  const [y2, m2, d2] = later.split("-").map(Number)
  const a = Date.UTC(y1, m1 - 1, d1)
  const b = Date.UTC(y2, m2 - 1, d2)
  return Math.round((b - a) / 86_400_000)
}

/** ISO-8601 week of a UTC date, such as 2026-W42. Weeks run Monday to Sunday. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const weekday = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - weekday)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

/** Monday and Sunday day stamps of an ISO week. */
export function isoWeekRange(week: string): { start: string; end: string } {
  const match = week.match(/^(\d{4})-W(\d{2})$/)
  if (!match) throw new Error("Invalid week.")
  const year = Number(match[1]), number = Number(match[2])
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (number - 1) * 7)
  const start = monday.toISOString().slice(0, 10)
  return { start, end: addDays(start, 6) }
}

/**
 * The week whose Sunday digest should exist by now: from Sunday 12:00 UTC the current week; Monday to
 * Wednesday the week that just ended, so a quiet Sunday never loses a digest; otherwise none.
 */
export function digestWeekDue(now: Date): string | null {
  const weekday = now.getUTCDay()
  if (weekday === 0) return now.getUTCHours() >= 12 ? isoWeek(now) : null
  if (weekday >= 1 && weekday <= 3) {
    const sunday = new Date(now)
    sunday.setUTCDate(sunday.getUTCDate() - weekday)
    return isoWeek(sunday)
  }
  return null
}
