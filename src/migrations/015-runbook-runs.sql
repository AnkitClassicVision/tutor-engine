CREATE TABLE IF NOT EXISTS runbook_runs (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, student_id TEXT, runbook TEXT NOT NULL, version INTEGER NOT NULL, role TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, attempts INTEGER NOT NULL,
  rules TEXT NOT NULL DEFAULT '{}', critic TEXT NOT NULL DEFAULT '{}', ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runbook_runs_owner ON runbook_runs(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS runbook_runs_runbook ON runbook_runs(runbook, version, created_at);
