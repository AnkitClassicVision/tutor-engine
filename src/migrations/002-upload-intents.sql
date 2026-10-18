CREATE TABLE IF NOT EXISTS upload_intents (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  student_id TEXT NOT NULL REFERENCES students(id),
  stored_path TEXT NOT NULL,
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS upload_intents_expiry ON upload_intents(expires_at);
