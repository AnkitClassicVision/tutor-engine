CREATE TABLE IF NOT EXISTS planner_messages (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), role TEXT NOT NULL, body TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT '', params TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
  job_id TEXT, decision_id TEXT, source TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS planner_messages_student ON planner_messages(student_id, created_at);
CREATE TABLE IF NOT EXISTS parent_notes (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT
);
CREATE INDEX IF NOT EXISTS parent_notes_student ON parent_notes(student_id, created_at);
CREATE TABLE IF NOT EXISTS digests (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id), week TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL, read_at TEXT, UNIQUE(owner_user_id, week)
);
