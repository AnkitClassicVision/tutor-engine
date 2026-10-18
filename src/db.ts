import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { migrateJourney } from "./journey-db.ts"
import { migrateSecrets } from "./secrets.ts"
import { DatabaseSync } from "node:sqlite"
import { openRowsSync, STILL_SEALED } from "./family-crypto.ts"

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000")
  migrate(db)
  ensureColumn(db, "students", "birth_date", "ALTER TABLE students ADD COLUMN birth_date TEXT")
  ensureColumn(db, "students", "grade_hold", "ALTER TABLE students ADD COLUMN grade_hold INTEGER NOT NULL DEFAULT 0")
  ensureColumn(db, "students", "math_course", "ALTER TABLE students ADD COLUMN math_course TEXT NOT NULL DEFAULT 'grade'")
  ensureColumn(db, "students", "subjects", "ALTER TABLE students ADD COLUMN subjects TEXT NOT NULL DEFAULT '[\"Math\"]'")
  ensureColumn(db, "tutor_sessions", "mode", "ALTER TABLE tutor_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'session'")
  ensureColumn(db, "tutor_sessions", "subject", "ALTER TABLE tutor_sessions ADD COLUMN subject TEXT NOT NULL DEFAULT 'Math'")
  ensureColumn(db, "session_items", "submitted_at", "ALTER TABLE session_items ADD COLUMN submitted_at TEXT")
  ensureColumn(db, "session_items", "grader", "ALTER TABLE session_items ADD COLUMN grader TEXT")
  ensureColumn(db, "session_items", "grading_reason", "ALTER TABLE session_items ADD COLUMN grading_reason TEXT")
  ensureColumn(db, "subject_plans", "build_status", "ALTER TABLE subject_plans ADD COLUMN build_status TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, "subject_plans", "build_note", "ALTER TABLE subject_plans ADD COLUMN build_note TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, "subject_plans", "agenda", "ALTER TABLE subject_plans ADD COLUMN agenda TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, "users", "ai_provider", "ALTER TABLE users ADD COLUMN ai_provider TEXT NOT NULL DEFAULT 'grok'")
  ensureColumn(db, "users", "ai_model", "ALTER TABLE users ADD COLUMN ai_model TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, "users", "ai_key", "ALTER TABLE users ADD COLUMN ai_key TEXT NOT NULL DEFAULT ''")
  migrateJourney(db)
  migrateSecrets(db)
  return openFamilyData(db)
}

/** Children's data sealed per family reads back as plain values; statements stay synchronous for SQLite callers. */
function openFamilyData(db: DatabaseSync) {
  const raw = db.prepare.bind(db)
  const query = (sql: string, ...values: string[]) => raw(sql).all(...values) as Array<Record<string, any>>
  db.prepare = ((sql: string) => sql.includes(STILL_SEALED) ? raw(sql) : new Proxy(raw(sql), {
    get(statement, name) {
      if (name === "get") return (...values: any[]) => { const row = statement.get(...values); return row ? openRowsSync([row as any], query)[0] : row }
      if (name === "all") return (...values: any[]) => openRowsSync(statement.all(...values) as any[], query)
      const value = Reflect.get(statement, name)
      return typeof value === "function" ? value.bind(statement) : value
    },
  })) as typeof db.prepare
  return db
}

function ensureColumn(db: DatabaseSync, table: string, column: string, sql: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((entry) => entry.name === column)) db.exec(sql)
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS decision_records (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id),
      kind TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      spec_revision TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      email TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      display_name TEXT NOT NULL,
      grade INTEGER NOT NULL,
      session_cap_minutes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      birth_date TEXT,
      grade_hold INTEGER NOT NULL DEFAULT 0,
      math_course TEXT NOT NULL DEFAULT 'grade',
      subjects TEXT NOT NULL DEFAULT '["Math"]'
    );
    CREATE TABLE IF NOT EXISTS learner_states (
      student_id TEXT NOT NULL REFERENCES students(id),
      concept_id TEXT NOT NULL,
      bloom_level INTEGER NOT NULL,
      mastery REAL NOT NULL,
      stability_days INTEGER NOT NULL,
      next_due TEXT NOT NULL,
      error_signatures TEXT NOT NULL,
      hints_last_10 INTEGER NOT NULL,
      mastered_in TEXT,
      status TEXT NOT NULL,
      PRIMARY KEY (student_id, concept_id)
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      bloom_level INTEGER NOT NULL,
      day TEXT NOT NULL,
      correct INTEGER NOT NULL,
      hints_used INTEGER NOT NULL,
      interleaved INTEGER NOT NULL,
      time_ms INTEGER NOT NULL,
      error_type TEXT,
      modality TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS targets (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      deadline TEXT,
      concept_ids TEXT NOT NULL,
      priority INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tutor_sessions (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      end_reason TEXT,
      modality TEXT NOT NULL,
      consecutive_step_downs INTEGER NOT NULL,
      cap_minutes INTEGER NOT NULL,
      continuity TEXT NOT NULL,
      break_until TEXT,
      pending_feedback TEXT
    );
    CREATE TABLE IF NOT EXISTS session_items (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES tutor_sessions(id),
      position INTEGER NOT NULL,
      beat TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      bloom_level INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      answer TEXT NOT NULL,
      hints_json TEXT NOT NULL,
      surface TEXT NOT NULL,
      interleaved INTEGER NOT NULL,
      partner_concept_id TEXT,
      hints_used INTEGER NOT NULL,
      hint_text TEXT,
      given_answer TEXT,
      answered INTEGER NOT NULL,
      correct INTEGER,
      error_type TEXT,
      time_ms INTEGER
    );
    CREATE TABLE IF NOT EXISTS recaps (
      session_id TEXT PRIMARY KEY,
      learned TEXT NOT NULL,
      hard TEXT NOT NULL,
      tell_friend TEXT NOT NULL,
      production_success INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sheets (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id),
      spec_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subject_sources (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_patterns (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      session_id TEXT NOT NULL,
      overt TEXT NOT NULL,
      subtle TEXT NOT NULL,
      trend TEXT NOT NULL,
      next_move TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subject_plans (
      student_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      about TEXT NOT NULL,
      question_types TEXT NOT NULL,
      syllabus_text TEXT NOT NULL,
      syllabus_name TEXT NOT NULL,
      build_status TEXT NOT NULL DEFAULT '',
      build_note TEXT NOT NULL DEFAULT '',
      agenda TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (student_id, subject)
    );
    CREATE TABLE IF NOT EXISTS custom_concepts (
      concept_id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id),
      subject TEXT NOT NULL,
      grade INTEGER NOT NULL,
      title TEXT NOT NULL,
      recall TEXT NOT NULL,
      example TEXT NOT NULL,
      non_example TEXT NOT NULL,
      purpose TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS practice_items (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id),
      concept_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      answer TEXT NOT NULL,
      bloom_level INTEGER NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS talk_messages (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      proposal TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lesson_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
}
