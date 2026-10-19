ALTER TABLE practice_items ADD COLUMN IF NOT EXISTS evidence_kind TEXT NOT NULL DEFAULT 'practice';
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS evidence_kind TEXT NOT NULL DEFAULT 'practice';
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS confidence TEXT;
