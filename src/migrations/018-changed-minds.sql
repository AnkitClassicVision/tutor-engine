CREATE TABLE IF NOT EXISTS changed_minds (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), session_id TEXT NOT NULL, concept_id TEXT NOT NULL,
  before_prompt TEXT NOT NULL, before_answer TEXT NOT NULL, after_prompt TEXT NOT NULL, after_answer TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(session_id, concept_id)
);
CREATE INDEX IF NOT EXISTS changed_minds_student ON changed_minds(student_id, created_at);
