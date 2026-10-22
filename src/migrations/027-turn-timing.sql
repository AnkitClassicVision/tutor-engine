ALTER TABLE session_items ADD COLUMN IF NOT EXISTS answer_saved_at TEXT;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS submit_to_save_ms INTEGER;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS active_work_ms INTEGER;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS grading_started_at TEXT;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS grading_finished_at TEXT;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS graded_at TEXT;
