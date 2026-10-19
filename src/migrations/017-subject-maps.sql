CREATE TABLE IF NOT EXISTS subject_maps (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), subject TEXT NOT NULL, version INTEGER NOT NULL,
  status TEXT NOT NULL, research TEXT NOT NULL DEFAULT '', map_json TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, decided_at TEXT, job_id TEXT
);
CREATE INDEX IF NOT EXISTS subject_maps_student ON subject_maps(student_id, subject, version);
ALTER TABLE custom_concepts ADD COLUMN IF NOT EXISTS prereqs TEXT NOT NULL DEFAULT '[]';
ALTER TABLE custom_concepts ADD COLUMN IF NOT EXISTS map_key TEXT NOT NULL DEFAULT '';
