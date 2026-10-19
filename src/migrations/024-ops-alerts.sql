-- Operations alerts for the site owner: one row per problem kind, so an ongoing problem is emailed once,
-- reminded daily and reported when it clears. No family data.
CREATE TABLE IF NOT EXISTS ops_alerts (
  code TEXT PRIMARY KEY, first_seen_at TEXT NOT NULL, last_sent_at TEXT, last_count INTEGER NOT NULL DEFAULT 0, resolved_at TEXT
);
