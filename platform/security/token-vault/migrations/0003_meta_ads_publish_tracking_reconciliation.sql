-- An encrypted, private rollback checkpoint for an idempotent ad-set
-- conversion reconciliation. The JSON contains raw Graph identifiers only in
-- ciphertext; journal responses store the opaque snapshot ID and fingerprints.
CREATE TABLE IF NOT EXISTS meta_ads_publish_adset_tracking_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  token_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  adset_id TEXT NOT NULL,
  profile_ref TEXT NOT NULL,
  previous_promoted_object_ciphertext TEXT NOT NULL,
  previous_promoted_object_fingerprint TEXT NOT NULL,
  desired_promoted_object_fingerprint TEXT NOT NULL,
  desired_tracking_promoted_object_ciphertext TEXT NOT NULL,
  tracking_keys_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'captured',
  restored_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (run_id) REFERENCES meta_ads_publish_runs(id),
  FOREIGN KEY (token_id) REFERENCES credential_tokens(id)
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_publish_tracking_snapshots_lookup
  ON meta_ads_publish_adset_tracking_snapshots(token_id, account_id, adset_id, status);
