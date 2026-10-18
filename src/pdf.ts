import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import type { Database } from './database.ts'
import type { JobContext } from './jobs.ts'
import { getSheet } from './services.ts'
import { cloudStorage, storePrivateFile, deletePrivateFile } from './storage.ts'
import { onWriteRollback } from './transaction.ts'

export async function renderSheetPdf(db: Database, uploads: string, ctx: JobContext, payload: { sheetId: string }) {
  const sheet = await getSheet(db, ctx.job.owner_user_id, payload.sheetId)
  const { spec, items } = JSON.parse(String(sheet.spec_json))
  await ctx.stage('Laying out your practice sheet')
  const doc = new PDFDocument({ size: 'LETTER', margin: 48 }), chunks: Buffer[] = []
  const rendered = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', chunk => chunks.push(Buffer.from(chunk)))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  const qr = await QRCode.toDataURL(payload.sheetId)
  function header() {
    doc.image(Buffer.from(qr.split(',')[1], 'base64'), 48, 40, { width: 55 })
    doc.fontSize(16).text(`${sheet.display_name} · Practice`, 120, 44).fontSize(8).text(payload.sheetId, 120, 68)
    for (const [x, y] of [[24, 24], [570, 24], [24, 744], [570, 744]]) doc.rect(x, y, 14, 14).stroke()
  }
  header()
  let y = 110
  for (const box of spec.boxes) {
    const item = items.find((i: any) => i.itemId === box.itemId)
    const text = `Box ${box.boxIndex}. ${item.prompt}`
    doc.fontSize(11)
    const height = doc.heightOfString(text, { width: 480 }) + 54
    if (y + height > 710) { doc.addPage(); header(); y = 110 }
    doc.text(text, 48, y, { width: 480 })
    doc.rect(48, y + height - 42, 480, 32).stroke()
    y += height + 16
  }
  doc.end()
  const bytes = await rendered
  let storedPath = ''
  const committed = await ctx.commit(async () => {
    const name = cloudStorage() ? `${ctx.job.id}.${ctx.job.run_token}.pdf` : `${ctx.job.id}.pdf`
    storedPath = await storePrivateFile(uploads, ctx.job.owner_user_id, name, bytes, 'application/pdf', 'pdf')
    onWriteRollback(db, () => deletePrivateFile(storedPath, uploads))
    if (cloudStorage()) await db.prepare('UPDATE jobs SET result = ? WHERE id = ? AND run_token = ?').run(JSON.stringify({ sheetId: payload.sheetId, file: true, storedPath }), ctx.job.id, ctx.job.run_token)
  })
  if (!committed) return { cancelled: true }
  return { sheetId: payload.sheetId, file: true, ...(cloudStorage() ? { storedPath } : {}) }
}
