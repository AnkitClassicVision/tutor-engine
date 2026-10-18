import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { createServer } from "node:http"
import { once } from "node:events"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { openDb } from "../src/db.ts"
import { handle } from "../src/server.ts"

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "tutor-"))
  const db = openDb(join(dir, "tutor.sqlite"))
  const server = createServer(async (req, res) => {
    handle(req, res, { db, uploadsDir: join(dir, "uploads"), judgeResponse: async () => null }).catch((error) => {
      console.error(error)
      res.writeHead(500)
      res.end(error instanceof Error ? error.message : "error")
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("no port")
  return { server, db, base: `http://127.0.0.1:${address.port}` }
}

function jar() {
  const cookies = new Map<string, string>()
  return {
    async request(base: string, path: string, init: { method?: string; body?: string } = {}) {
      const response = await fetch(base + path, {
        method: init.method ?? "GET",
        redirect: "manual",
        headers: {
          cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
          ...(init.body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        body: init.body,
      })
      for (const line of response.headers.getSetCookie()) {
        const pair = line.split(";")[0]
        const eq = pair.indexOf("=")
        const name = pair.slice(0, eq)
        const value = pair.slice(eq + 1)
        if (!value) cookies.delete(name)
        else cookies.set(name, value)
      }
      return { status: response.status, text: await response.text(), location: response.headers.get("location") }
    },
  }
}

function csrfOf(html: string) {
  const match = html.match(/name="csrf" value="([^"]+)"/)
  assert.ok(match, "page did not include a csrf field")
  return match[1]
}

/** A new family's first child redirects through the AI welcome step; the child id is in its next link. */
function studentFrom(location?: string) {
  const next = location?.startsWith("/welcome/ai") ? new URL(location, "http://x").searchParams.get("next") ?? "" : location ?? ""
  return next.split("/").pop()
}

test("parent accounts are isolated, hashed, and required", async () => {
  const app = await boot()
  try {
    const anon = jar()
    const blocked = await anon.request(app.base, "/students")
    assert.equal(blocked.status, 303)
    assert.equal(blocked.location, "/")
    const forged = await anon.request(app.base, "/register", {
      method: "POST",
      body: new URLSearchParams({ email: "a@example.com", password: "correct-horse" }).toString(),
    })
    assert.equal(forged.status, 403)

    const home = await anon.request(app.base, "/")
    const created = await anon.request(app.base, "/register", {
      method: "POST",
      body: new URLSearchParams({ csrf: csrfOf(home.text), email: "a@example.com", password: "correct-horse" }).toString(),
    })
    assert.equal(created.status, 303)
    const stored = (await app.db.prepare("SELECT password_hash FROM users WHERE email = ?").get("a@example.com")) as {
      password_hash: string
    }
    assert.match(stored.password_hash, /^scrypt\$/)
    assert.equal(stored.password_hash.includes("correct-horse"), false)

    const page = await anon.request(app.base, "/students")
    assert.equal(page.status, 200)
    const added = await anon.request(app.base, "/students", {
      method: "POST",
      body: new URLSearchParams({
        csrf: csrfOf(page.text),
        displayName: "Ada",
        grade: "5",
        sessionCapMinutes: "25",
      }).toString(),
    })
    assert.equal(added.status, 303)
    const studentId = studentFrom(added.location)
    assert.ok(studentId)

    const other = jar()
    const otherHome = await other.request(app.base, "/")
    await other.request(app.base, "/register", {
      method: "POST",
      body: new URLSearchParams({
        csrf: csrfOf(otherHome.text),
        email: "b@example.com",
        password: "another-secret",
      }).toString(),
    })
    const stolen = await other.request(app.base, `/students/${studentId}`)
    assert.equal(stolen.status, 404)

    const states = (await app.db.prepare("SELECT COUNT(*) AS n FROM learner_states WHERE student_id = ?").get(studentId)) as {
      n: number
    }
    assert.ok(states.n >= 20)
    const program = (await app.db.prepare("SELECT kind FROM targets WHERE student_id = ?").get(studentId)) as { kind: string }
    assert.equal(program.kind, "program")
  } finally {
    app.server.close()
  }
})

test("a session scores the current item, stops at the cap, and prints a sheet", async () => {
  const app = await boot()
  try {
    const client = jar()
    const home = await client.request(app.base, "/")
    await client.request(app.base, "/register", {
      method: "POST",
      body: new URLSearchParams({ csrf: csrfOf(home.text), email: "parent@example.com", password: "correct-horse" }).toString(),
    })
    const roster = await client.request(app.base, "/students")
    const added = await client.request(app.base, "/students", {
      method: "POST",
      body: new URLSearchParams({
        csrf: csrfOf(roster.text),
        displayName: "Lin",
        grade: "5",
        sessionCapMinutes: "25",
      }).toString(),
    })
    const studentId = studentFrom(added.location) ?? ""
    const detail = await client.request(app.base, `/students/${studentId}`)
    assert.match(detail.text, /Homework/)
    assert.match(detail.text, /Today’s mission/)
    assert.match(detail.text, /Skip the lesson/)
    const history = await client.request(app.base, `/students/${studentId}/history`)
    assert.equal(history.status, 200)
    assert.match(history.text, /Decisions and history/)
    const started = await client.request(app.base, `/students/${studentId}/session`, {
      method: "POST",
      body: new URLSearchParams({ csrf: csrfOf(detail.text) }).toString(),
    })
    const sessionId = started.location?.split("/").pop() ?? ""
    const live = await client.request(app.base, `/session/${sessionId}`)
    const activeCount = Number((await app.db.prepare("SELECT count(*) n FROM session_items WHERE session_id = ? AND skipped = 0").get(sessionId))!.n)
    assert.match(live.text, new RegExp(`1 of ${activeCount}`))
    const item = (await app.db.prepare("SELECT id, answer FROM session_items WHERE session_id = ? ORDER BY position LIMIT 1").get(sessionId)) as {
      id: string
      answer: string
    }
    const answered = await client.request(app.base, `/session/${sessionId}/answer`, {
      method: "POST",
      body: new URLSearchParams({ csrf: csrfOf(live.text), itemId: item.id, answer: item.answer, timeMs: "1200" }).toString(),
    })
    assert.equal(answered.status, 303)
    const storedItem = (await app.db.prepare("SELECT correct FROM session_items WHERE id = ?").get(item.id)) as { correct: number | null }
    if (storedItem.correct == null) {
      const waiting = await client.request(app.base, `/session/${sessionId}`)
      assert.match(waiting.text, /Parent review/)
      await client.request(app.base, `/session/${sessionId}/review`, {
        method: "POST",
        body: new URLSearchParams({ csrf: csrfOf(waiting.text), itemId: item.id, verdict: "success" }).toString(),
      })
    }
    const attempt = (await app.db.prepare("SELECT correct FROM attempts WHERE session_id = ?").get(sessionId)) as { correct: number }
    assert.equal(attempt.correct, 1)

    await app.db.prepare("UPDATE tutor_sessions SET started_at = ? WHERE id = ?").run(new Date(Date.now() - 26 * 60 * 1000).toISOString(), sessionId)
    const next = (await app.db.prepare("SELECT id FROM session_items WHERE session_id = ? AND answered = 0 ORDER BY position LIMIT 1").get(sessionId)) as {
      id: string
    }
    const page = await client.request(app.base, `/session/${sessionId}`)
    await client.request(app.base, `/session/${sessionId}/answer`, {
      method: "POST",
      body: new URLSearchParams({ csrf: csrfOf(page.text), itemId: next.id, answer: "0", timeMs: "1000" }).toString(),
    })
    const ended = (await app.db.prepare("SELECT end_reason FROM tutor_sessions WHERE id = ?").get(sessionId)) as { end_reason: string }
    assert.equal(ended.end_reason, "attention")

    const sheet = await client.request(app.base, `/students/${studentId}/sheet`, {
      method: "POST",
      body: new URLSearchParams({ csrf: csrfOf(detail.text) }).toString(),
    })
    const sheetId = sheet.location?.split("/").pop() ?? ""
    const printed = await client.request(app.base, `/sheet/${sheetId}`)
    assert.match(printed.text, /Box 1/)
    assert.match(printed.text, new RegExp(sheetId))
    assert.match(printed.text, /<svg/i)
    const stolen = jar()
    const stolenHome = await stolen.request(app.base, "/")
    await stolen.request(app.base, "/register", {
      method: "POST",
      body: new URLSearchParams({ csrf: csrfOf(stolenHome.text), email: "other@example.com", password: "another-secret" }).toString(),
    })
    const hidden = await stolen.request(app.base, `/sheet/${sheetId}`)
    assert.equal(hidden.status, 404)
  } finally {
    app.server.close()
  }
})
