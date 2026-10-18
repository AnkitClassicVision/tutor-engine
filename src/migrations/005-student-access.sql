ALTER TABLE students ADD COLUMN IF NOT EXISTS access_code TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS access_pin_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS student_only INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS students_access_code ON students(access_code) WHERE access_code != '';
