ALTER TABLE tutor_sessions ADD COLUMN IF NOT EXISTS lesson_done INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tutor_sessions ADD COLUMN IF NOT EXISTS carried_from TEXT;
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS shown_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS tutor_sessions_waiting_review ON tutor_sessions(goal) WHERE goal LIKE 'waiting_review:%';
