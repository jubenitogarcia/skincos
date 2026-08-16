-- A one-time, staging-only Meta Ads tracking seed has a separate durable
-- journal. Raw Graph IDs, the temporary source token and created-object
-- ownership stay encrypted in state_ciphertext; summary_json is aggregate-only.
CREATE TABLE IF NOT EXISTS meta_ads_publish_staging_seed_operations (
  id TEXT PRIMARY KEY,
  operation_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'pending',
    'creating',
    'sealed',
    'rolling_back',
    'rolled_back',
    'reconciliation_required'
  )),
  state_ciphertext TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_publish_staging_seed_operations_updated
  ON meta_ads_publish_staging_seed_operations(updated_at);
