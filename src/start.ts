import { openDb } from "./db.ts"
import { sealAllFamilyData } from "./family-crypto.ts"
import { resumeBuilds, startServer } from "./server.ts"
import { parentMailConfigured } from './parent-mail.ts'

const port = Number(process.env.TUTOR_PORT ?? 8787)
const host = process.env.TUTOR_HOST ?? "127.0.0.1"
const dbPath = process.env.TUTOR_DB ?? "data/tutor.sqlite"
const uploadsDir = process.env.TUTOR_UPLOADS ?? "data/uploads"
if (process.env.TUTOR_PUBLIC === '1') {
  if (process.env.TUTOR_SECURE !== '1' || !process.env.TUTOR_ORIGIN?.startsWith('https://')) throw new Error('Public mode requires HTTPS origin and secure cookies.')
  if (!parentMailConfigured()) throw new Error('Public mode requires email delivery for verification and recovery.')
}
const db = openDb(dbPath)
// Children's data saved before per-family encryption is sealed before serving.
await sealAllFamilyData(db)
if (process.env.TUTOR_PUBLIC !== "1") await resumeBuilds(db)
const server = (await startServer({ db, uploadsDir, host, port }))
server.on("listening", () => {
  console.log(`Tutor is ready at http://${host}:${port}`)
})
