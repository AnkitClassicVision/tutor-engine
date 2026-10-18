-- Tutor schema, generated from an empty local database. Contains no family records.
CREATE TABLE IF NOT EXISTS users (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    , ai_provider TEXT NOT NULL DEFAULT 'grok', ai_model TEXT NOT NULL DEFAULT '', ai_key TEXT NOT NULL DEFAULT '', photo_model TEXT NOT NULL DEFAULT '', email_verified_at TEXT);

CREATE TABLE IF NOT EXISTS auth_sessions (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    , selected_student TEXT, parent_unlocked_until TEXT);

CREATE TABLE IF NOT EXISTS login_attempts (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  email TEXT NOT NULL,
      at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS students (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      display_name TEXT NOT NULL,
      grade INTEGER NOT NULL,
      session_cap_minutes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      birth_date TEXT,
      grade_hold INTEGER NOT NULL DEFAULT 0,
      math_course TEXT NOT NULL DEFAULT 'grade',
      subjects TEXT NOT NULL DEFAULT '["Math"]'
    , presentation TEXT NOT NULL DEFAULT 'auto', last_duration INTEGER NOT NULL DEFAULT 10);

CREATE TABLE IF NOT EXISTS decision_records (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id),
      kind TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      spec_revision TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS learner_states (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  student_id TEXT NOT NULL REFERENCES students(id),
      concept_id TEXT NOT NULL,
      bloom_level INTEGER NOT NULL,
      mastery DOUBLE PRECISION NOT NULL,
      stability_days INTEGER NOT NULL,
      next_due TEXT NOT NULL,
      error_signatures TEXT NOT NULL,
      hints_last_10 INTEGER NOT NULL,
      mastered_in TEXT,
      status TEXT NOT NULL,
      PRIMARY KEY (student_id, concept_id)
    );

CREATE TABLE IF NOT EXISTS attempts (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      bloom_level INTEGER NOT NULL,
      day TEXT NOT NULL,
      correct INTEGER NOT NULL,
      hints_used INTEGER NOT NULL,
      interleaved INTEGER NOT NULL,
      time_ms INTEGER NOT NULL,
      error_type TEXT,
      modality TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS targets (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      deadline TEXT,
      concept_ids TEXT NOT NULL,
      priority INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS tutor_sessions (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      end_reason TEXT,
      modality TEXT NOT NULL,
      consecutive_step_downs INTEGER NOT NULL,
      cap_minutes INTEGER NOT NULL,
      continuity TEXT NOT NULL,
      break_until TEXT,
      pending_feedback TEXT
    , mode TEXT NOT NULL DEFAULT 'session', subject TEXT NOT NULL DEFAULT 'Math', goal TEXT NOT NULL DEFAULT 'practice', material_id TEXT, question_id TEXT, paused_at TEXT);

CREATE TABLE IF NOT EXISTS session_items (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES tutor_sessions(id),
      position INTEGER NOT NULL,
      beat TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      bloom_level INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      answer TEXT NOT NULL,
      hints_json TEXT NOT NULL,
      surface TEXT NOT NULL,
      interleaved INTEGER NOT NULL,
      partner_concept_id TEXT,
      hints_used INTEGER NOT NULL,
      hint_text TEXT,
      given_answer TEXT,
      answered INTEGER NOT NULL,
      correct INTEGER,
      error_type TEXT,
      time_ms INTEGER
    , submitted_at TEXT, grader TEXT, grading_reason TEXT, draft_answer TEXT);

CREATE TABLE IF NOT EXISTS recaps (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  session_id TEXT PRIMARY KEY,
      learned TEXT NOT NULL,
      hard TEXT NOT NULL,
      tell_friend TEXT NOT NULL,
      production_success INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS sheets (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id),
      spec_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    , score_results TEXT);

CREATE TABLE IF NOT EXISTS subject_sources (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS learning_patterns (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      session_id TEXT NOT NULL,
      overt TEXT NOT NULL,
      subtle TEXT NOT NULL,
      trend TEXT NOT NULL,
      next_move TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS subject_plans (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  student_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      about TEXT NOT NULL,
      question_types TEXT NOT NULL,
      syllabus_text TEXT NOT NULL,
      syllabus_name TEXT NOT NULL,
      build_status TEXT NOT NULL DEFAULT '',
      build_note TEXT NOT NULL DEFAULT '',
      agenda TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (student_id, subject)
    );

CREATE TABLE IF NOT EXISTS custom_concepts (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  concept_id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id),
      subject TEXT NOT NULL,
      grade INTEGER NOT NULL,
      title TEXT NOT NULL,
      recall TEXT NOT NULL,
      example TEXT NOT NULL,
      non_example TEXT NOT NULL,
      purpose TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS practice_items (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id),
      concept_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      answer TEXT NOT NULL,
      bloom_level INTEGER NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS talk_messages (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      proposal TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS lesson_messages (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS uploads (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS jobs (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id), student_id TEXT,
      kind TEXT NOT NULL, payload TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', stage TEXT NOT NULL DEFAULT 'Waiting to start',
      result TEXT, error TEXT, run_token TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, started_at TEXT, updated_at TEXT NOT NULL, lease_until TEXT,
      UNIQUE(owner_user_id, idempotency_key)
    );

CREATE TABLE IF NOT EXISTS materials (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), kind TEXT NOT NULL,
      title TEXT NOT NULL, subject TEXT NOT NULL, work_state TEXT NOT NULL, request_key TEXT, input_hash TEXT, revision INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'saved', created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS material_pages (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id), upload_id TEXT REFERENCES uploads(id),
      position INTEGER NOT NULL, original_upload_id TEXT, transcription TEXT NOT NULL DEFAULT '', UNIQUE(material_id, position)
    );

CREATE TABLE IF NOT EXISTS material_questions (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id), page_id TEXT,
      revision INTEGER NOT NULL, number TEXT NOT NULL, prompt TEXT NOT NULL, figure TEXT NOT NULL DEFAULT '',
      visible_work TEXT NOT NULL DEFAULT '', answer_key TEXT NOT NULL DEFAULT '', teacher_mark TEXT NOT NULL DEFAULT '',
      concept_id TEXT, readable INTEGER NOT NULL, confidence DOUBLE PRECISION NOT NULL
    );

CREATE TABLE IF NOT EXISTS homework_reviews (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES material_questions(id), revision INTEGER NOT NULL,
      verdict TEXT NOT NULL, explanation TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      created_at TEXT NOT NULL, UNIQUE(question_id, revision)
    );

CREATE TABLE IF NOT EXISTS guided_attempts (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES material_questions(id), role TEXT NOT NULL,
      body TEXT NOT NULL, assistance INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS school_results (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), material_id TEXT,
      title TEXT NOT NULL, date TEXT NOT NULL, earned DOUBLE PRECISION NOT NULL, possible DOUBLE PRECISION NOT NULL,
      provenance TEXT NOT NULL, notes TEXT NOT NULL, created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS followup_missions (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), concept_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL, due TEXT NOT NULL, completed_session TEXT, UNIQUE(student_id, concept_id, evidence_id, due)
    );

CREATE TABLE IF NOT EXISTS path_revisions (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), evidence_id TEXT NOT NULL,
      reason TEXT NOT NULL, created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS oauth_states (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), auth_session_id TEXT NOT NULL,
      verifier TEXT NOT NULL, expires_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS account_tokens (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
      expires_at TEXT NOT NULL, consumed_at TEXT
    );

CREATE TABLE IF NOT EXISTS mail_outbox (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
      message TEXT NOT NULL, sent_at TEXT, created_at TEXT NOT NULL
    );

CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status, lease_until, created_at);
CREATE INDEX IF NOT EXISTS jobs_student ON jobs(student_id, created_at);
CREATE INDEX IF NOT EXISTS attempts_student_concept ON attempts(student_id, concept_id, created_at);
CREATE INDEX IF NOT EXISTS attempts_student_date ON attempts(student_id, created_at);
CREATE INDEX IF NOT EXISTS sessions_student ON tutor_sessions(student_id, started_at);
CREATE INDEX IF NOT EXISTS items_session ON session_items(session_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS materials_requests ON materials(student_id, request_key);
