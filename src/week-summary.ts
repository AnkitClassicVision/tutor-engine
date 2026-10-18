import type { Database as DatabaseSync } from "./database.ts"
import { adventureFor, assertStudent, learningOverview, listSubjectPlans, scoreboardFor, titleMap, topicMenu } from "./services.ts"
import { milestoneKeepsake } from "./engine/adventure.ts"
import { dayStamp, addDays } from "./engine/dates.ts"

export interface WeekFacts {
  studentId: string
  name: string
  weekStart: string
  today: string
  activeDays: number
  missions: number
  classes: string[]
  mastered: string[]
  frontier: string[]
  stuck: string[]
  held: number
  checked: number
  reviewsDue: number
  gaps: string[]
  strong: string[]
  independent: number
  supported: number
  pending: number
  days: number
  milestones: string[]
  upcomingTest: { title: string; deadline: string } | null
  nextTitle: string | null
  nextSubject: string | null
}

export async function weekFactsFor(db: DatabaseSync, owner: string, studentId: string, now = new Date()): Promise<WeekFacts> {
  const student: any = await assertStudent(db, owner, studentId)
  const today = dayStamp(now), weekStart = addDays(today, -6)
  const [board, overview, milestones, titles, plans, menu] = await Promise.all([
    scoreboardFor(db, owner, studentId, now), learningOverview(db, owner, studentId), adventureFor(db, owner, studentId), titleMap(db, studentId), listSubjectPlans(db, owner, studentId), topicMenu(db, owner, studentId),
  ])
  const active = (await db.prepare("SELECT count(DISTINCT day) n FROM attempts WHERE student_id = ? AND day >= ?").get(studentId, weekStart)) as { n: number } | undefined
  const missions = (await db.prepare(`SELECT count(*) n FROM tutor_sessions s WHERE student_id = ? AND coalesce(s.goal, '') NOT LIKE 'waiting_review:%' AND started_at >= ? AND EXISTS (SELECT 1 FROM session_items i WHERE i.session_id = s.id) AND NOT EXISTS (SELECT 1 FROM session_items i WHERE i.session_id = s.id AND i.answered = 0 AND i.skipped = 0)`).get(studentId, `${weekStart}T00:00:00.000Z`)) as { n: number } | undefined
  const test = (await db.prepare("SELECT title, deadline FROM targets WHERE student_id = ? AND kind = 'target' AND deadline >= ? ORDER BY deadline LIMIT 1").get(studentId, today)) as { title: string; deadline: string } | undefined
  const name = (id: string) => titles[id] ?? id
  return {
    studentId, name: String(student.display_name), weekStart, today,
    activeDays: Number(active?.n ?? 0), missions: Number(missions?.n ?? 0),
    classes: [...new Set([...menu.subjects, ...plans.map((p) => p.subject)])],
    mastered: board.conceptsMasteredThisWeek.map((s) => name(s.conceptId)),
    frontier: board.frontier.map((s) => name(s.conceptId)),
    stuck: board.stuck.map((s) => name(s.conceptId)),
    held: board.retention7.held, checked: board.retention7.checked,
    reviewsDue: overview.due.length,
    gaps: overview.gaps.slice(0, 3).map((s: any) => name(String(s.conceptId))),
    strong: overview.strong.slice(0, 3).map((s: any) => name(String(s.conceptId))),
    independent: overview.independent, supported: overview.supported, pending: overview.pending, days: overview.days,
    milestones: milestones.filter((m: any) => String(m.day ?? "") >= weekStart).map((m: any) => milestoneKeepsake(m).name),
    upcomingTest: test ? { title: String(test.title), deadline: String(test.deadline) } : null,
    nextTitle: overview.next?.title ?? null, nextSubject: overview.next?.subject ?? null,
  }
}

function list(items: string[], max = 3) {
  const shown = items.slice(0, max)
  const rest = items.length - shown.length
  return shown.join(", ") + (rest > 0 ? ` and ${rest} more` : "")
}

/** Two or three plain sentences a parent can read in ten seconds. No model call. */
export function weekSentences(f: WeekFacts): string[] {
  const lines: string[] = []
  if (!f.classes.length) lines.push(`${f.name} has no class set up yet, so there is nothing to practise.`)
  else if (f.activeDays === 0) lines.push(`${f.name} has not practised yet this week.`)
  else lines.push(`${f.name} practised on ${f.activeDays} day${f.activeDays === 1 ? "" : "s"} this week and finished ${f.missions} mission${f.missions === 1 ? "" : "s"}.`)
  if (f.mastered.length) lines.push(`New this week: ${list(f.mastered)}.`)
  else if (f.frontier.length) lines.push(`Right now the work is on ${list(f.frontier, 2)}.`)
  if (f.checked) lines[lines.length - 1] += ` ${f.held} of ${f.checked} earlier topics still held when checked again.`
  if (f.stuck.length) lines.push(`${f.stuck[0]} is sticking: recent tries keep missing it.`)
  else if (f.reviewsDue) lines.push(`${f.reviewsDue} review${f.reviewsDue === 1 ? " is" : "s are"} due.`)
  else if (f.gaps.length) lines.push(`${f.gaps[0]} needs another look.`)
  return lines.slice(0, 3)
}

export interface SuggestedAction { label: string; kind: "planner" | "note"; prefill: string; subject: string }

export function suggestedAction(f: WeekFacts): SuggestedAction {
  const first = f.classes[0] ?? ""
  if (!f.classes.length) return { label: "Plan the first class", kind: "planner", prefill: "Add a class called ", subject: "new" }
  if (f.stuck.length) return { label: `Ask the planner about ${f.stuck[0]}`, kind: "planner", prefill: `${f.name} is stuck on ${f.stuck[0]}. What should change next week?`, subject: f.nextSubject ?? first }
  if (f.upcomingTest && f.upcomingTest.deadline <= addDays(f.today, 10)) return { label: `Prepare for ${f.upcomingTest.title}`, kind: "planner", prefill: `There is a test, ${f.upcomingTest.title}, on ${f.upcomingTest.deadline}. Point the next missions at it.`, subject: first }
  if (f.reviewsDue >= 3) return { label: "Make the next missions reviews", kind: "planner", prefill: "Spend this week's missions on the reviews that are due.", subject: first }
  if (f.activeDays === 0) return { label: `Leave a note for ${f.name}`, kind: "note", prefill: `Tell ${f.name}: `, subject: first }
  return { label: `Change what's next in ${first}`, kind: "planner", prefill: `Change the ${first} class: `, subject: first }
}
