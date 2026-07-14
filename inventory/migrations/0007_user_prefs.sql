-- Per-user UI preferences (layout, collapsed state, etc.)
CREATE TABLE IF NOT EXISTS insumos_user_prefs (
  username TEXT PRIMARY KEY,
  prefs_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

