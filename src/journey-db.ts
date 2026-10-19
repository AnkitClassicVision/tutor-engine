import type { DatabaseSync } from 'node:sqlite'

export function migrateJourney(db: DatabaseSync) {
  const columns: Record<string, Record<string, string>> = {
    session_items: { shown_at: 'TEXT', skipped: 'INTEGER NOT NULL DEFAULT 0', skip_reason: "TEXT NOT NULL DEFAULT ''", draft_answer: 'TEXT', format: "TEXT NOT NULL DEFAULT 'text'", choices_json: 'TEXT', explanation: "TEXT NOT NULL DEFAULT ''", evidence_kind: "TEXT NOT NULL DEFAULT 'practice'", confidence: 'TEXT', disputed: 'INTEGER NOT NULL DEFAULT 0', grading_doubt: 'TEXT', rubric_json: 'TEXT', concern: 'TEXT', access_support: 'TEXT', visible_at: 'TEXT', feedback_visible_at: 'TEXT' },
    sheets: { score_results: 'TEXT' },
    students: { access_code: "TEXT NOT NULL DEFAULT ''", access_code_hash: "TEXT NOT NULL DEFAULT ''", access_pin_hash: "TEXT NOT NULL DEFAULT ''", presentation: "TEXT NOT NULL DEFAULT 'auto'", world: "TEXT NOT NULL DEFAULT 'cartoon'", last_duration: 'INTEGER NOT NULL DEFAULT 10', pack_child_requests: "TEXT NOT NULL DEFAULT 'classes'", pack_child_mode: "TEXT NOT NULL DEFAULT 'now'", pack_daily_limit: 'INTEGER NOT NULL DEFAULT 3', experiments: "TEXT NOT NULL DEFAULT '{}'" },
    auth_sessions: { student_only: 'INTEGER NOT NULL DEFAULT 0', selected_student: 'TEXT', parent_unlocked_until: 'TEXT' },
    users: { photo_model: "TEXT NOT NULL DEFAULT ''", data_key: "TEXT NOT NULL DEFAULT ''", email_verified_at: 'TEXT', ai_refresh_lease: 'TEXT', chatgpt_welcomed_at: 'TEXT' },
    tutor_sessions: { lesson_done: 'INTEGER NOT NULL DEFAULT 1', carried_from: 'TEXT', feedback_cursor: 'INTEGER NOT NULL DEFAULT 0', goal: "TEXT NOT NULL DEFAULT 'practice'", material_id: 'TEXT', question_id: 'TEXT', paused_at: 'TEXT', requested_at: 'TEXT', paused_ms: 'INTEGER NOT NULL DEFAULT 0' },
    custom_concepts: { prereqs: "TEXT NOT NULL DEFAULT '[]'", map_key: "TEXT NOT NULL DEFAULT ''" },
    practice_items: { rubric_json: 'TEXT', evidence_kind: "TEXT NOT NULL DEFAULT 'practice'", pack_id: 'TEXT', format: "TEXT NOT NULL DEFAULT 'text'", choices_json: 'TEXT', hints_json: 'TEXT', explanation: "TEXT NOT NULL DEFAULT ''" },
  }
  for (const [table, fields] of Object.entries(columns)) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
    for (const [name, type] of Object.entries(fields)) if (!existing.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS students_access_code ON students(access_code) WHERE access_code != ''")
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS students_access_code_hash ON students(access_code_hash) WHERE access_code_hash != ''")
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS tutor_sessions_waiting_review ON tutor_sessions(goal) WHERE goal LIKE 'waiting_review:%'")
  db.exec(`
CREATE TABLE IF NOT EXISTS auth_throttle (
  key TEXT PRIMARY KEY, window_start TEXT NOT NULL, count INTEGER NOT NULL, owner_user_id TEXT
);
CREATE TABLE IF NOT EXISTS file_erasures (
  id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, stored_path TEXT NOT NULL, upload_id TEXT,
  retain_until TEXT NOT NULL, retry_after TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  UNIQUE(owner_user_id, stored_path)
);
CREATE INDEX IF NOT EXISTS file_erasures_retry ON file_erasures(retry_after);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id), student_id TEXT,
      kind TEXT NOT NULL, payload TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', stage TEXT NOT NULL DEFAULT 'Waiting to start',
      result TEXT, error TEXT, run_token TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, started_at TEXT, updated_at TEXT NOT NULL, lease_until TEXT,
      UNIQUE(owner_user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status, lease_until, created_at);
    CREATE INDEX IF NOT EXISTS jobs_student ON jobs(student_id, created_at);
CREATE TABLE IF NOT EXISTS upload_intents (
  id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id), student_id TEXT NOT NULL REFERENCES students(id),
  stored_path TEXT NOT NULL, mime TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, completed_at TEXT,
  reserved_bytes INTEGER NOT NULL DEFAULT 15000000
);
CREATE INDEX IF NOT EXISTS upload_intents_expiry ON upload_intents(expires_at);
CREATE INDEX IF NOT EXISTS jobs_family_active ON jobs(owner_user_id, status);
CREATE INDEX IF NOT EXISTS jobs_student_paid ON jobs(student_id, created_at);
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), kind TEXT NOT NULL,
      title TEXT NOT NULL, subject TEXT NOT NULL, work_state TEXT NOT NULL, request_key TEXT, input_hash TEXT, revision INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'saved', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS material_pages (
      id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id), upload_id TEXT REFERENCES uploads(id),
      position INTEGER NOT NULL, original_upload_id TEXT, transcription TEXT NOT NULL DEFAULT '', UNIQUE(material_id, position)
    );
    CREATE TABLE IF NOT EXISTS material_questions (
      id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id), page_id TEXT,
      revision INTEGER NOT NULL, number TEXT NOT NULL, prompt TEXT NOT NULL, figure TEXT NOT NULL DEFAULT '',
      visible_work TEXT NOT NULL DEFAULT '', answer_key TEXT NOT NULL DEFAULT '', teacher_mark TEXT NOT NULL DEFAULT '',
      concept_id TEXT, readable INTEGER NOT NULL, confidence REAL NOT NULL,
      confirmed_revision INTEGER, child_prompt TEXT, confirmed_by TEXT
    );
    CREATE TABLE IF NOT EXISTS homework_reviews (
      id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES material_questions(id), revision INTEGER NOT NULL,
      verdict TEXT NOT NULL, explanation TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      created_at TEXT NOT NULL, UNIQUE(question_id, revision)
    );
    CREATE TABLE IF NOT EXISTS guided_attempts (
      id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES material_questions(id), role TEXT NOT NULL,
      body TEXT NOT NULL, assistance INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS school_results (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), material_id TEXT,
      title TEXT NOT NULL, date TEXT NOT NULL, earned REAL NOT NULL, possible REAL NOT NULL,
      provenance TEXT NOT NULL, notes TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS followup_missions (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), concept_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL, due TEXT NOT NULL, completed_session TEXT, UNIQUE(student_id, concept_id, evidence_id, due)
    );
    CREATE TABLE IF NOT EXISTS path_revisions (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), evidence_id TEXT NOT NULL,
      reason TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_states (
      state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), auth_session_id TEXT NOT NULL,
      verifier TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account_tokens (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
      expires_at TEXT NOT NULL, consumed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS mail_outbox (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
      message TEXT NOT NULL, sent_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS planner_messages (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), role TEXT NOT NULL, body TEXT NOT NULL,
      intent TEXT NOT NULL DEFAULT '', params TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
      job_id TEXT, decision_id TEXT, source TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS planner_messages_student ON planner_messages(student_id, created_at);
    CREATE TABLE IF NOT EXISTS parent_notes (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS parent_notes_student ON parent_notes(student_id, created_at);
    CREATE TABLE IF NOT EXISTS packs (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), requested_by TEXT NOT NULL, request TEXT NOT NULL, request_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'now', runbook_id TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued', brief_json TEXT NOT NULL DEFAULT '{}', draft_json TEXT, check_json TEXT, qa_json TEXT,
      concept_ids TEXT NOT NULL DEFAULT '[]', target_id TEXT, job_id TEXT, decision_id TEXT, first_session_id TEXT,
      provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT, UNIQUE(student_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS packs_student ON packs(student_id, created_at);
    CREATE TABLE IF NOT EXISTS grading_audits (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), item_id TEXT NOT NULL UNIQUE, grader TEXT NOT NULL,
      ai_correct INTEGER NOT NULL, parent_agrees INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS grading_audits_student ON grading_audits(student_id, created_at);
    CREATE TABLE IF NOT EXISTS changed_minds (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), session_id TEXT NOT NULL, concept_id TEXT NOT NULL,
      before_prompt TEXT NOT NULL, before_answer TEXT NOT NULL, after_prompt TEXT NOT NULL, after_answer TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(session_id, concept_id)
    );
    CREATE INDEX IF NOT EXISTS changed_minds_student ON changed_minds(student_id, created_at);
    CREATE TABLE IF NOT EXISTS subject_maps (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), subject TEXT NOT NULL, version INTEGER NOT NULL,
      status TEXT NOT NULL, research TEXT NOT NULL DEFAULT '', map_json TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, decided_at TEXT, job_id TEXT
    );
    CREATE INDEX IF NOT EXISTS subject_maps_student ON subject_maps(student_id, subject, version);
    CREATE TABLE IF NOT EXISTS runbook_runs (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, student_id TEXT, runbook TEXT NOT NULL, version INTEGER NOT NULL, role TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, attempts INTEGER NOT NULL,
      rules TEXT NOT NULL DEFAULT '{}', critic TEXT NOT NULL DEFAULT '{}', ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runbook_runs_owner ON runbook_runs(owner_user_id, created_at);
    CREATE INDEX IF NOT EXISTS runbook_runs_runbook ON runbook_runs(runbook, version, created_at);
    CREATE INDEX IF NOT EXISTS practice_items_pack ON practice_items(pack_id);
    CREATE TABLE IF NOT EXISTS digests (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id), week TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
      created_at TEXT NOT NULL, read_at TEXT, UNIQUE(owner_user_id, week)
    );
    CREATE INDEX IF NOT EXISTS attempts_student_concept ON attempts(student_id, concept_id, created_at);
    CREATE INDEX IF NOT EXISTS attempts_student_date ON attempts(student_id, created_at);
    CREATE INDEX IF NOT EXISTS sessions_student ON tutor_sessions(student_id, started_at);
    CREATE INDEX IF NOT EXISTS items_session ON session_items(session_id, position);
  `)
  for (const column of ['request_key', 'input_hash']) if (!db.prepare('PRAGMA table_info(materials)').all().some(c => c.name === column)) db.exec(`ALTER TABLE materials ADD COLUMN ${column} TEXT`)
  const materialColumns: Record<string, string> = {
    scope_approved: 'INTEGER NOT NULL DEFAULT 1',
    learning_purpose: "TEXT NOT NULL DEFAULT ''", test_title: "TEXT NOT NULL DEFAULT ''", test_date: 'TEXT',
    learning_version: 'INTEGER NOT NULL DEFAULT 0', learning_applied_revision: 'INTEGER NOT NULL DEFAULT 0',
    learning_applied_version: 'INTEGER NOT NULL DEFAULT 0', learning_target_id: 'TEXT',
  }
  for (const [column, type] of Object.entries(materialColumns)) if (!db.prepare('PRAGMA table_info(materials)').all().some(c => c.name === column)) db.exec(`ALTER TABLE materials ADD COLUMN ${column} ${type}`)
  if (!db.prepare('PRAGMA table_info(packs)').all().some(c => c.name === 'admitted_at')) {
    db.exec('ALTER TABLE packs ADD COLUMN admitted_at TEXT')
    db.exec("UPDATE packs SET admitted_at = created_at WHERE job_id IS NOT NULL")
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS materials_requests ON materials(student_id, request_key)')
  for (const column of ['request_key', 'input_hash']) if (!db.prepare('PRAGMA table_info(school_results)').all().some(c => c.name === column)) db.exec(`ALTER TABLE school_results ADD COLUMN ${column} TEXT`)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS school_results_requests ON school_results(student_id, request_key)')
  if (!db.prepare('PRAGMA table_info(material_pages)').all().some(c => c.name === 'original_upload_id')) db.exec('ALTER TABLE material_pages ADD COLUMN original_upload_id TEXT')
  // WF-05: the child's check of a homework question, kept beside the original reading.
  if (!db.prepare('PRAGMA table_info(material_questions)').all().some(c => c.name === 'confirmed_revision')) {
    for (const [column, type] of Object.entries({ confirmed_revision: 'INTEGER', child_prompt: 'TEXT', confirmed_by: 'TEXT' })) db.exec(`ALTER TABLE material_questions ADD COLUMN ${column} ${type}`)
    // Help already under way before this check existed keeps going without asking again.
    db.exec('UPDATE material_questions SET confirmed_revision = revision WHERE id IN (SELECT DISTINCT question_id FROM guided_attempts)')
  }
  const oauthColumns: Record<string, string> = { provider: "TEXT NOT NULL DEFAULT 'openrouter'", nonce: "TEXT NOT NULL DEFAULT ''", client_id: "TEXT NOT NULL DEFAULT ''", redirect_uri: "TEXT NOT NULL DEFAULT ''" }
  for (const [column, type] of Object.entries(oauthColumns)) if (!db.prepare('PRAGMA table_info(oauth_states)').all().some(c => c.name === column)) db.exec(`ALTER TABLE oauth_states ADD COLUMN ${column} ${type}`)
}
