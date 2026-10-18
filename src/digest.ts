import { sealFor } from "./family-crypto.ts"
import type { Database as DatabaseSync } from "./database.ts"
import { createJob, type JobHandler } from "./jobs.ts"
import { listStudents } from "./services.ts"
import { weekFactsFor, weekSentences, suggestedAction } from "./week-summary.ts"
import { digestWeekDue, isoWeekRange } from "./engine/dates.ts"
import { encryptSecret } from "./secrets.ts"
import { parentMailConfigured } from "./parent-mail.ts"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const label = (day: string) => { const [, m, d] = day.split("-").map(Number); return `${MONTHS[m - 1]} ${d}` }
export const weekLabel = (week: string) => { const { start, end } = isoWeekRange(week); return `${label(start)} to ${label(end)}` }

/** Queues one digest job per family for the week now due. Safe to call on every request. */
export async function enqueueWeeklyDigests(db: DatabaseSync, now = new Date()) {
  const week = digestWeekDue(now)
  if (!week) return 0
  const key = `digest:${week}`
  const verified = process.env.TUTOR_PUBLIC === "1" ? "u.email_verified_at IS NOT NULL AND" : ""
  const families = (await db.prepare(`SELECT u.id FROM users u WHERE ${verified} EXISTS (SELECT 1 FROM students s WHERE s.owner_user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.owner_user_id = u.id AND j.idempotency_key = ?)`).all(key)) as Array<{ id: string }>
  let queued = 0
  for (const family of families) {
    // The payload is fixed so a concurrent sweep reuses the same job instead of failing.
    try { await createJob(db, String(family.id), null, "weekly_digest", { week }, key); queued++ } catch { /* Another request queued it first. */ }
  }
  return queued
}

export async function composeDigest(db: DatabaseSync, owner: string, week: string) {
  const { end } = isoWeekRange(week)
  const asOf = new Date(`${end}T23:59:59Z`)
  const origin = (process.env.TUTOR_ORIGIN || "http://127.0.0.1:8787").replace(/\/$/, "")
  const students = await listStudents(db, owner)
  const blocks: string[] = []
  const names: string[] = []
  for (const student of students) {
    const facts = await weekFactsFor(db, owner, String(student.id), asOf)
    names.push(facts.name)
    const action = suggestedAction(facts)
    const lines = [
      facts.name.toUpperCase(),
      ...weekSentences(facts),
      facts.milestones.length ? `Earned this week: ${facts.milestones.slice(0, 4).join(", ")}.` : "",
      facts.upcomingTest ? `Coming up: ${facts.upcomingTest.title} on ${label(facts.upcomingTest.deadline)}.` : "",
      facts.nextTitle ? `Next mission: ${facts.nextTitle}.` : "",
      `Suggested for next week: ${action.label}.`,
      `Open ${facts.name}'s parent area: ${origin}/students/${student.id}/parent`,
    ].filter(Boolean)
    blocks.push(lines.join("\n"))
  }
  const together = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "your family"
  const subject = `This week with ${together}`
  const text = [
    "Hello,",
    "",
    `Here is the week of ${weekLabel(week)}.`,
    "",
    blocks.join("\n\n"),
    "",
    "To change anything, open the parent area and use the planner. Nothing changes until you press Apply.",
    "",
    "This summary is sent on Sundays and is also saved in the parent area under Weekly digests.",
  ].join("\n")
  return { subject, text, students: students.length }
}

export function weeklyDigestJob(db: DatabaseSync): JobHandler {
  return async (ctx, payload: { week: string }) => {
    const owner = ctx.job.owner_user_id, week = String(payload.week)
    await ctx.stage("Writing this week’s summary")
    const digest = await composeDigest(db, owner, week)
    if (!digest.students) return { week, students: 0 }
    const id = `digest:${owner}:${week}`, now = new Date().toISOString()
    await ctx.commit(async () => {
      await db.prepare("INSERT OR IGNORE INTO digests (id, owner_user_id, week, subject, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, owner, week, await sealFor(db, owner, digest.subject), await sealFor(db, owner, digest.text), now)
      // The fixed id keeps a retried job from sending twice; the provider deduplicates on the same id.
      if (parentMailConfigured()) {
        await db.prepare("INSERT OR IGNORE INTO mail_outbox (id, user_id, kind, message, created_at) VALUES (?, ?, 'digest', ?, ?)")
          .run(id, owner, encryptSecret(JSON.stringify({ kind: "digest", subject: digest.subject, text: digest.text })), now)
      }
    })
    return { week, students: digest.students }
  }
}

export async function listDigests(db: DatabaseSync, owner: string, limit = 12) {
  return (await db.prepare("SELECT id, week, subject, body, created_at, read_at FROM digests WHERE owner_user_id = ? ORDER BY week DESC LIMIT ?").all(owner, limit)) as Array<{
    id: string; week: string; subject: string; body: string; created_at: string; read_at: string | null
  }>
}

export async function unreadDigest(db: DatabaseSync, owner: string) {
  return (await db.prepare("SELECT id, week FROM digests WHERE owner_user_id = ? AND read_at IS NULL ORDER BY week DESC LIMIT 1").get(owner)) as { id: string; week: string } | undefined
}

export async function markDigestsRead(db: DatabaseSync, owner: string) {
  await db.prepare("UPDATE digests SET read_at = ? WHERE owner_user_id = ? AND read_at IS NULL").run(new Date().toISOString(), owner)
}
