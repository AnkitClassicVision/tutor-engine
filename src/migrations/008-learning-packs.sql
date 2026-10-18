ALTER TABLE practice_items ADD COLUMN IF NOT EXISTS pack_id TEXT;
ALTER TABLE practice_items ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'text';
ALTER TABLE practice_items ADD COLUMN IF NOT EXISTS choices_json TEXT;
ALTER TABLE practice_items ADD COLUMN IF NOT EXISTS hints_json TEXT;
ALTER TABLE practice_items ADD COLUMN IF NOT EXISTS explanation TEXT NOT NULL DEFAULT '';
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'text';
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS choices_json TEXT;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS explanation TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS pack_child_requests TEXT NOT NULL DEFAULT 'classes';
ALTER TABLE students ADD COLUMN IF NOT EXISTS pack_child_mode TEXT NOT NULL DEFAULT 'now';
ALTER TABLE students ADD COLUMN IF NOT EXISTS pack_daily_limit INTEGER NOT NULL DEFAULT 3;
CREATE TABLE IF NOT EXISTS packs (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), requested_by TEXT NOT NULL, request TEXT NOT NULL, request_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'now', runbook_id TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued', brief_json TEXT NOT NULL DEFAULT '{}', draft_json TEXT, check_json TEXT, qa_json TEXT,
  concept_ids TEXT NOT NULL DEFAULT '[]', target_id TEXT, job_id TEXT, decision_id TEXT, first_session_id TEXT,
  provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT, UNIQUE(student_id, request_id)
);
CREATE INDEX IF NOT EXISTS packs_student ON packs(student_id, created_at);
CREATE INDEX IF NOT EXISTS practice_items_pack ON practice_items(pack_id);
