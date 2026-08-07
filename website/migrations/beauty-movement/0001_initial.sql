-- Cartas da Beleza em Movimento
--
-- This database is intentionally isolated from espacofacial-booking. Apply this
-- migration with Wrangler only after the dedicated D1 binding/database exists.
-- The application must never create this schema at runtime.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bm_campaigns (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'disabled', 'closed')),
    starts_at_ms INTEGER,
    ends_at_ms INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    invitation_title TEXT NOT NULL DEFAULT '',
    invitation_text TEXT NOT NULL DEFAULT '',
    partner_name TEXT NOT NULL DEFAULT '',
    whatsapp_message_courtesy TEXT NOT NULL DEFAULT '',
    whatsapp_message_commercial TEXT NOT NULL DEFAULT '',
    whatsapp_label TEXT NOT NULL DEFAULT '',
    conditions_label TEXT NOT NULL DEFAULT '',
    conditions_text TEXT NOT NULL DEFAULT '',
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    CHECK(starts_at_ms IS NULL OR starts_at_ms <= ends_at_ms)
);

CREATE INDEX IF NOT EXISTS idx_bm_campaigns_status_ends
ON bm_campaigns(status, ends_at_ms);

CREATE TABLE IF NOT EXISTS bm_invites (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    external_ref TEXT NOT NULL,
    invite_token_hmac TEXT NOT NULL UNIQUE,
    personal_data_version INTEGER NOT NULL DEFAULT 1 CHECK(personal_data_version = 1),
    personal_data_ciphertext TEXT NOT NULL,
    personal_data_iv TEXT NOT NULL,
    contact_mask TEXT NOT NULL,
    palette TEXT NOT NULL CHECK(palette IN ('radiancia', 'ritmo', 'conexao')),
    benefit_status TEXT NOT NULL CHECK(benefit_status IN ('aula_cortesia_evento', 'evento_condicao_comercial')),
    benefit_text TEXT NOT NULL,
    benefit_validity TEXT NOT NULL,
    benefit_rules TEXT NOT NULL,
    terms_version TEXT NOT NULL,
    invite_status TEXT NOT NULL DEFAULT 'active' CHECK(invite_status IN ('active', 'revoked')),
    expires_at_ms INTEGER NOT NULL,
    operational_consent_at_ms INTEGER,
    confirmed_at_ms INTEGER,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(campaign_id, external_ref),
    FOREIGN KEY(campaign_id) REFERENCES bm_campaigns(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_bm_invites_campaign_status_expiry
ON bm_invites(campaign_id, invite_status, expires_at_ms);

CREATE INDEX IF NOT EXISTS idx_bm_invites_confirmation
ON bm_invites(campaign_id, confirmed_at_ms, updated_at_ms);

CREATE TABLE IF NOT EXISTS bm_sessions (
    id TEXT PRIMARY KEY,
    invite_id TEXT NOT NULL,
    session_token_hmac TEXT NOT NULL UNIQUE,
    client_ip_hmac TEXT,
    expires_at_ms INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    last_seen_at_ms INTEGER NOT NULL,
    revoked_at_ms INTEGER,
    FOREIGN KEY(invite_id) REFERENCES bm_invites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bm_sessions_invite_expiry
ON bm_sessions(invite_id, expires_at_ms);

CREATE TABLE IF NOT EXISTS bm_card_reveals (
    invite_id TEXT NOT NULL,
    act_index INTEGER NOT NULL CHECK(act_index BETWEEN 1 AND 3),
    card_id TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY(invite_id, act_index),
    FOREIGN KEY(invite_id) REFERENCES bm_invites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bm_rate_limit_windows (
    scope TEXT NOT NULL,
    subject_hmac TEXT NOT NULL,
    window_started_at_ms INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL,
    blocked_until_ms INTEGER,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(scope, subject_hmac)
);

CREATE TABLE IF NOT EXISTS bm_import_runs (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    input_sha256 TEXT NOT NULL,
    source_row_count INTEGER NOT NULL,
    accepted_row_count INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('applied', 'failed')),
    created_at_ms INTEGER NOT NULL,
    applied_at_ms INTEGER,
    UNIQUE(campaign_id, input_sha256),
    FOREIGN KEY(campaign_id) REFERENCES bm_campaigns(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_bm_import_runs_campaign_applied
ON bm_import_runs(campaign_id, applied_at_ms DESC);
