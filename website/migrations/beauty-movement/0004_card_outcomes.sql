-- Card-derived commercial outcomes. This is additive: legacy reward columns
-- remain readable, but modern invitations resolve and persist an offer from
-- the three stored cards only.

PRAGMA foreign_keys = ON;

ALTER TABLE bm_invites ADD COLUMN outcome_key TEXT;
ALTER TABLE bm_invites ADD COLUMN outcome_snapshot_json TEXT;
ALTER TABLE bm_invites ADD COLUMN outcome_protocol_version TEXT;
ALTER TABLE bm_invites ADD COLUMN outcome_resolved_at_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_bm_invites_campaign_outcome
ON bm_invites(campaign_id, outcome_key, outcome_resolved_at_ms);
