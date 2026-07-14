-- Booking domain ledger and durable outbox.
-- Apply through the Booking-owned D1 migration command only after staging
-- validation. This migration is additive and does not alter the existing
-- Website booking tables during the coexistence phase.

CREATE TABLE IF NOT EXISTS booking_ledger (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK (state IN ('provisional', 'confirmed', 'failed', 'manual_review')),
    request_json TEXT NOT NULL,
    result_json TEXT,
    status_token_hash TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    confirmed_at_ms INTEGER,
    failed_at_ms INTEGER,
    manual_review_at_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_booking_ledger_state_updated
    ON booking_ledger(state, updated_at_ms);

CREATE TABLE IF NOT EXISTS booking_outbox (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL REFERENCES booking_ledger(id),
    topic TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'leased', 'delivered', 'dead_letter')),
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_until_ms INTEGER,
    available_at_ms INTEGER NOT NULL,
    delivered_at_ms INTEGER,
    last_error TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_booking_outbox_dispatch
    ON booking_outbox(state, available_at_ms, lease_until_ms);
