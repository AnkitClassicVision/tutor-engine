import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDb } from "../src/db.ts"
import { registerUser } from "../src/auth.ts"
import { createStudent } from "../src/services.ts"
import { runNextJob } from "../src/jobs.ts"
import { flushMail, deleteFamily } from "../src/accounts.ts"
import { decryptSecret } from "../src/secrets.ts"
import { digestWeekDue, isoWeek, isoWeekRange } from "../src/engine/dates.ts"
import { composeDigest, enqueueWeeklyDigests, listDigests, unreadDigest, markDigestsRead, weeklyDigestJob } from "../src/digest.ts"

test("ISO weeks cross year boundaries correctly", () => {
  assert.equal(isoWeek(new Date("2026-10-18T13:00:00Z")), "2026-W42")
  assert.equal(isoWeek(new Date("2026-12-28T00:00:00Z")), "2026-W53")
  assert.equal(isoWeek(new Date("2027-01-03T23:00:00Z")), "2026-W53")
  assert.equal(isoWeek(new Date("2027-01-04T00:00:00Z")), "2027-W01")
  assert.deepEqual(isoWeekRange("2026-W42"), { start: "2026-10-12", end: "2026-10-18" })
  assert.deepEqual(isoWeekRange("2026-W53"), { start: "2026-12-28", end: "2027-01-03" })
})

test("a digest is due from Sunday noon UTC and caught up until Wednesday", () => {
  assert.equal(digestWeekDue(new Date("2026-10-18T11:59:00Z")), null)
  assert.equal(digestWeekDue(new Date("2026-10-18T12:00:00Z")), "2026-W42")
  assert.equal(digestWeekDue(new Date("2026-10-20T09:00:00Z")), "2026-W42")
  assert.equal(digestWeekDue(new Date("2026-10-21T23:00:00Z")), "2026-W42")
  assert.equal(digestWeekDue(new Date("2026-10-22T09:00:00Z")), null)
  assert.equal(digestWeekDue(new Date("2026-10-15T09:00:00Z")), null)
})

test("one digest per family per week is saved, emailed once through a lost response, and deleted with the family", async () => {
  const keys = ["TUTOR_MAIL_PROVIDER", "TUTOR_MAIL_FROM", "RESEND_API_KEY", "TUTOR_SECRET_DIR", "TUTOR_PUBLIC", "NODE_ENV", "TUTOR_ORIGIN"]
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  const root = mkdtempSync(join(tmpdir(), "tutor-digest-"))
  Object.assign(process.env, { TUTOR_MAIL_PROVIDER: "resend", TUTOR_MAIL_FROM: "Synthetic Tutor <account@example.invalid>", RESEND_API_KEY: "synthetic-provider-key", TUTOR_SECRET_DIR: root, TUTOR_PUBLIC: "0", NODE_ENV: "production", TUTOR_ORIGIN: "https://tutor.example.invalid" })
  const realFetch = globalThis.fetch
  const sent: Array<{ key: string; body: any }> = []
  let lose = true
  globalThis.fetch = async (url: any, options: any) => {
    assert.equal(String(url), "https://api.resend.com/emails")
    const key = new Headers(options.headers).get("idempotency-key")!
    sent.push({ key, body: JSON.parse(String(options.body)) })
    if (lose) { lose = false; throw new TypeError("Synthetic lost provider response") }
    return new Response(JSON.stringify({ id: "synthetic" }), { status: 200 })
  }
  const db = openDb(join(root, "digest.sqlite"))
  try {
    const user = await registerUser(db, "digest@example.invalid", "synthetic-digest-password")
    assert.ok(user.ok)
    await createStudent(db, user.userId, { displayName: "Synthetic learner", grade: 3, sessionCapMinutes: 10 })
    await createStudent(db, user.userId, { displayName: "Second learner", grade: 5, sessionCapMinutes: 10 })
    const sunday = new Date("2026-10-18T13:00:00Z")
    assert.equal(await enqueueWeeklyDigests(db, sunday), 1)
    assert.equal(await enqueueWeeklyDigests(db, sunday), 0)
    assert.equal(await enqueueWeeklyDigests(db, new Date("2026-10-19T09:00:00Z")), 0, "the Monday catch-up sees the same week")
    assert.equal(await runNextJob(db, { weekly_digest: weeklyDigestJob(db) }), true)
    const rows = await listDigests(db, user.userId)
    assert.equal(rows.length, 1); assert.equal(rows[0].week, "2026-W42")
    assert.match(rows[0].subject, /Synthetic learner and Second learner/)
    assert.match(rows[0].body, /week of Oct 12 to Oct 18/)
    assert.match(rows[0].body, /https:\/\/tutor\.example\.invalid\/students\/.+\/parent/)
    const outbox = (await db.prepare("SELECT id, kind, message FROM mail_outbox WHERE kind = 'digest'").get()) as any
    assert.equal(outbox.id, `digest:${user.userId}:2026-W42`)
    assert.equal(JSON.parse(decryptSecret(outbox.message)).subject, rows[0].subject)
    await assert.rejects(flushMail(db, 5))
    await flushMail(db, 5)
    const digestSends = sent.filter((s) => s.key === `tutor-parent-mail/${outbox.id}`)
    assert.equal(digestSends.length, 2, "a lost response is retried with the same key")
    assert.deepEqual(digestSends[0].body, digestSends[1].body)
    assert.equal(digestSends[1].body.subject, rows[0].subject)
    assert.equal(((await db.prepare("SELECT message FROM mail_outbox WHERE id = ?").get(outbox.id)) as any).message, "")
    assert.ok(await unreadDigest(db, user.userId))
    await markDigestsRead(db, user.userId)
    assert.equal(await unreadDigest(db, user.userId), undefined)
    const composed = await composeDigest(db, user.userId, "2026-W42")
    assert.equal(composed.students, 2)
    await deleteFamily(db, user.userId, join(root, "uploads"))
    assert.equal(((await db.prepare("SELECT count(*) n FROM digests").get()) as any).n, 0)
  } finally {
    globalThis.fetch = realFetch
    db.close()
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
})
