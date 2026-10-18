const CUTOFF_MONTH = 9
const CUTOFF_DAY = 1

export function schoolYearStart(today: Date): number {
  const month = today.getMonth() + 1
  const day = today.getDate()
  if (month > CUTOFF_MONTH || (month === CUTOFF_MONTH && day >= CUTOFF_DAY)) return today.getFullYear()
  return today.getFullYear() - 1
}

export function gradeFromBirthday(birthDate: string, today: Date): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate)
  if (!match) throw new Error("Birthday must be a real date.")
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error("Birthday must be a real date.")
  if (year < 1995 || birthDate > dayStamp(today)) throw new Error("Birthday must be a real date.")
  const start = schoolYearStart(today)
  const madeCutoff = month < CUTOFF_MONTH || (month === CUTOFF_MONTH && day <= CUTOFF_DAY)
  const ageOnCutoff = start - year - (madeCutoff ? 0 : 1)
  return ageOnCutoff - 5
}

export function nextGradeChange(today: Date): string {
  return `${schoolYearStart(today) + 1}-09-01`
}

export function gradeLabel(grade: number): string {
  if (grade === 0) return "Kindergarten"
  return `Grade ${grade}`
}

function dayStamp(today: Date): string {
  const month = String(today.getMonth() + 1).padStart(2, "0")
  const day = String(today.getDate()).padStart(2, "0")
  return `${today.getFullYear()}-${month}-${day}`
}
