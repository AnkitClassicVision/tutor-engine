ALTER TABLE practice_items ADD COLUMN IF NOT EXISTS rubric_json TEXT;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS rubric_json TEXT;
