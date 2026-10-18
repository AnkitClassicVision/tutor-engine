ALTER TABLE students ADD COLUMN IF NOT EXISTS access_code_hash TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS students_access_code_hash ON students(access_code_hash) WHERE access_code_hash != '';
