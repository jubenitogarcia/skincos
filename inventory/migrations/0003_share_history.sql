CREATE TABLE IF NOT EXISTS share_history (
    id TEXT PRIMARY KEY,
    user TEXT NOT NULL,
    created_at TEXT NOT NULL,
    title TEXT,
    text TEXT,
    url TEXT,
    files_json TEXT,
    source_id TEXT
);

CREATE INDEX IF NOT EXISTS share_history_user_created_at
ON share_history (user, created_at);
