import type { Database } from '../../src/database.ts'
import { createStudent, createTarget } from '../../src/services.ts'
import { evidenceAnswer } from './evidence-history.ts'

/** Prior synthetic checks create a specific procedural gap; the browser starts and completes the actual mission. */
export async function seedTeachingRoute(db: Database, owner: string) {
  const now = new Date(), concept = 'math.5.nf.a.1'
  const student = await createStudent(db, owner, { displayName: 'Synthetic fraction learner', grade: 5, sessionCapMinutes: 5 })
  await createTarget(db, owner, student, { title: 'Fraction addition', conceptIds: [concept], deadline: new Date(now.getTime() + 86400000).toISOString().slice(0,10) })
  for (let index = 0; index < 3; index++) await evidenceAnswer(db, owner, student, `${owner}:teaching-prior-${index}`, new Date(now.getTime() - (3-index)*60000), { concept, level: 3, correct: index !== 2 })
  return student
}
