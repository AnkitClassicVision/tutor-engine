-- Additive only. Evidence cutover is an explicit separate operation, never migration/preview boot.
ALTER TABLE students ADD COLUMN IF NOT EXISTS evidence_policy INTEGER;
ALTER TABLE students ADD COLUMN IF NOT EXISTS experiment_policy TEXT;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS evidence_purpose TEXT NOT NULL DEFAULT 'learning';
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS evidence_policy INTEGER;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS revision_id TEXT;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS task_evidence TEXT;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS mixed_evidence TEXT;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS submitted_revision TEXT;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS confidence_at TEXT;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS confidence_revision TEXT;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS confidence_support INTEGER;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS evidence_policy INTEGER;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS evidence_json TEXT;
CREATE TABLE IF NOT EXISTS learning_cutovers (
  rowid BIGSERIAL UNIQUE, student_id TEXT PRIMARY KEY REFERENCES students(id), policy INTEGER NOT NULL, created_at TEXT NOT NULL,
  attempt_ids_json TEXT NOT NULL, states_json TEXT NOT NULL, milestones_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS learning_exposures (
  rowid BIGSERIAL UNIQUE, id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), session_id TEXT NOT NULL,
  item_id TEXT, revision_id TEXT, concept_id TEXT NOT NULL, bloom_level INTEGER NOT NULL,
  kind TEXT NOT NULL, at TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS learning_exposures_concept ON learning_exposures(student_id, concept_id, at);
