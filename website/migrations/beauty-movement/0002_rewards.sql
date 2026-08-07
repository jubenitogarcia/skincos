-- Preconfigured celebration benefits.
--
-- This migration is additive. The legacy benefit columns on bm_invites remain
-- populated during the transition so an old private report cannot silently
-- lose the approved condition. New imports must reference bm_rewards by
-- reward_id and the application joins the structured catalog before exposing
-- any benefit after confirmation.

PRAGMA foreign_keys = ON;

ALTER TABLE bm_campaigns ADD COLUMN velocity_benefit_label TEXT NOT NULL DEFAULT '';
ALTER TABLE bm_campaigns ADD COLUMN velocity_benefit_text TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS bm_rewards (
    campaign_id TEXT NOT NULL,
    reward_id TEXT NOT NULL,
    family TEXT NOT NULL CHECK(family IN ('radiancia', 'ritmo', 'conexao')),
    reward_type TEXT NOT NULL CHECK(reward_type IN ('free_procedure', 'discount')),
    procedure_id TEXT NOT NULL,
    procedure_name TEXT NOT NULL,
    discount_kind TEXT CHECK(discount_kind IS NULL OR discount_kind IN ('percent', 'fixed')),
    discount_value REAL,
    discount_currency TEXT CHECK(discount_currency IS NULL OR discount_currency = 'BRL'),
    display_text TEXT NOT NULL,
    validity TEXT NOT NULL,
    rules TEXT NOT NULL,
    terms_version TEXT NOT NULL,
    approved_at_ms INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(campaign_id, reward_id),
    FOREIGN KEY(campaign_id) REFERENCES bm_campaigns(id) ON DELETE RESTRICT,
    CHECK(
        (reward_type = 'free_procedure' AND discount_kind IS NULL AND discount_value IS NULL AND discount_currency IS NULL)
        OR
        (reward_type = 'discount' AND discount_kind IS NOT NULL AND discount_value IS NOT NULL AND discount_value > 0 AND discount_currency = 'BRL')
    ),
    CHECK(discount_kind <> 'percent' OR discount_value <= 100)
);

CREATE INDEX IF NOT EXISTS idx_bm_rewards_campaign_family
ON bm_rewards(campaign_id, family, reward_id);

ALTER TABLE bm_invites ADD COLUMN reward_id TEXT;
ALTER TABLE bm_invites ADD COLUMN velocity_benefit TEXT NOT NULL DEFAULT 'none'
    CHECK(velocity_benefit IN ('none', 'aula_cortesia_evento'));

CREATE INDEX IF NOT EXISTS idx_bm_invites_campaign_reward
ON bm_invites(campaign_id, reward_id);
