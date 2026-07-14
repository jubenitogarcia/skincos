CREATE TABLE IF NOT EXISTS auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  username TEXT,
  ip TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_user_ts ON auth_attempts(username, ts);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_ip_ts ON auth_attempts(ip, ts);
