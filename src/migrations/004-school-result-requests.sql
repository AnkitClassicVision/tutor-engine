ALTER TABLE school_results ADD COLUMN IF NOT EXISTS request_key TEXT;
ALTER TABLE school_results ADD COLUMN IF NOT EXISTS input_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS school_results_requests ON school_results(student_id, request_key);
