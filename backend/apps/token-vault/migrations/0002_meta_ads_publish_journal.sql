CREATE TABLE IF NOT EXISTS meta_ads_publish_runs (
  id TEXT PRIMARY KEY,
  batch_fingerprint TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  workflow_execution_id TEXT,
  config_revision TEXT NOT NULL,
  status TEXT NOT NULL,
  files_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT NOT NULL DEFAULT '{}',
  heartbeat_at TEXT NOT NULL,
  lock_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_publish_runs_status_updated
  ON meta_ads_publish_runs(status, updated_at);

CREATE TABLE IF NOT EXISTS meta_ads_publish_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  destination_group TEXT NOT NULL,
  creative_group_key TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  status TEXT NOT NULL,
  previous_state_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (run_id) REFERENCES meta_ads_publish_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_publish_jobs_run_status
  ON meta_ads_publish_jobs(run_id, status);

CREATE TABLE IF NOT EXISTS meta_ads_publish_operations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT NOT NULL DEFAULT '{}',
  meta_trace_id TEXT,
  rate_usage_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (run_id) REFERENCES meta_ads_publish_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_publish_operations_run_status
  ON meta_ads_publish_operations(run_id, status);

CREATE TABLE IF NOT EXISTS meta_ads_publish_locks (
  resource_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_publish_locks_expires
  ON meta_ads_publish_locks(expires_at);

CREATE TABLE IF NOT EXISTS meta_ads_publish_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(run_id, event_key),
  FOREIGN KEY (run_id) REFERENCES meta_ads_publish_runs(id)
);

