CREATE TABLE IF NOT EXISTS grading_audits (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), item_id TEXT NOT NULL UNIQUE, grader TEXT NOT NULL,
  ai_correct INTEGER NOT NULL, parent_agrees INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS grading_audits_student ON grading_audits(student_id, created_at);
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS disputed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS experiments TEXT NOT NULL DEFAULT '{}';
