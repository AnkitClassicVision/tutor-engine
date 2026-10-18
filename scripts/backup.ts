import { openDb } from '../src/db.ts'
import { backupFamilyStore, restoreStore } from '../src/backup.ts'
const [operation, source, destination] = process.argv.slice(2)
if (operation === 'restore' && source && destination) console.log(restoreStore(source, destination))
else if (operation === 'create' && source) {
  const db = openDb(process.env.TUTOR_DB || 'data/tutor.sqlite')
  console.log(await backupFamilyStore(db, process.env.TUTOR_UPLOADS || 'data/uploads', source)); db.close()
} else throw new Error('Usage: npm run backup -- create NEW_BACKUP_DIR | restore BACKUP_DIR NEW_STORE_DIR')
