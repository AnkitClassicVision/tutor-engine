ALTER TABLE materials ADD COLUMN learning_purpose TEXT NOT NULL DEFAULT '';
ALTER TABLE materials ADD COLUMN test_title TEXT NOT NULL DEFAULT '';
ALTER TABLE materials ADD COLUMN test_date TEXT;
ALTER TABLE materials ADD COLUMN learning_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE materials ADD COLUMN learning_applied_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE materials ADD COLUMN learning_applied_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE materials ADD COLUMN learning_target_id TEXT;
