-- Invite-level prize authority. The spreadsheet assignment is immutable
-- campaign input; card reveals remain symbolic/auditable and may not change it.
-- NULL assigned_outcome_key represents the Velocity courtesy outcome when the
-- assignment protocol is present. Legacy rows have a NULL protocol and keep
-- the historical card-derived resolver.

PRAGMA foreign_keys = ON;

ALTER TABLE bm_invites ADD COLUMN assigned_outcome_key TEXT;
ALTER TABLE bm_invites ADD COLUMN assignment_protocol_version TEXT;
ALTER TABLE bm_invites ADD COLUMN planned_card_selections_json TEXT;

CREATE INDEX IF NOT EXISTS idx_bm_invites_campaign_assignment
ON bm_invites(campaign_id, assignment_protocol_version, assigned_outcome_key);
