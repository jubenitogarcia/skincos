-- Durable, encrypted saga state for the one-way legacy Meta Ads tracking
-- bootstrap.  Graph resource identifiers and promoted-object snapshots only
-- ever live in state_ciphertext; summary_json is deliberately sanitized.
CREATE TABLE IF NOT EXISTS meta_ads_publish_bootstrap_operations (
  id TEXT PRIMARY KEY,
  operation_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  expected_config_authority_revision TEXT NOT NULL,
  resulting_tracking_binding_revision TEXT,
  status TEXT NOT NULL CHECK(status IN (
    'pending',
    'fixture_created',
    'tracking_configured',
    'configuring',
    'applied',
    'rolled_back',
    'reconciliation_required'
  )),
  state_ciphertext TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_publish_bootstrap_operations_updated
  ON meta_ads_publish_bootstrap_operations(updated_at);
