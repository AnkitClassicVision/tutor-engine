ALTER TABLE materials ADD COLUMN IF NOT EXISTS scope_approved INTEGER NOT NULL DEFAULT 1;
ALTER TABLE packs ADD COLUMN IF NOT EXISTS admitted_at TEXT;
UPDATE packs SET admitted_at = created_at WHERE admitted_at IS NULL AND job_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS auth_throttle (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  key TEXT PRIMARY KEY, window_start TEXT NOT NULL, count INTEGER NOT NULL, owner_user_id TEXT
);
ALTER TABLE upload_intents ADD COLUMN IF NOT EXISTS reserved_bytes BIGINT NOT NULL DEFAULT 15000000;
CREATE INDEX IF NOT EXISTS jobs_family_active ON jobs(owner_user_id, status);
CREATE INDEX IF NOT EXISTS jobs_student_paid ON jobs(student_id, created_at);
CREATE TABLE IF NOT EXISTS file_erasures (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, stored_path TEXT NOT NULL, upload_id TEXT,
  retain_until TEXT NOT NULL, retry_after TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  UNIQUE(owner_user_id, stored_path)
);
CREATE INDEX IF NOT EXISTS file_erasures_retry ON file_erasures(retry_after);
