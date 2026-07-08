-- Booking (MVP)
-- Apply with:
--   wrangler d1 migrations apply espacofacial-booking

CREATE TABLE IF NOT EXISTS booking_requests (
    id TEXT PRIMARY KEY,
    unit_slug TEXT NOT NULL,
    doctor_slug TEXT NOT NULL,
    service_id TEXT NOT NULL,
    start_at_ms INTEGER NOT NULL,
    end_at_ms INTEGER NOT NULL,
    status TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    notes TEXT,
    created_at_ms INTEGER NOT NULL,
    confirm_by_ms INTEGER NOT NULL,
    decided_at_ms INTEGER,
    decided_by TEXT,
    decision_note TEXT,
    override_conflict INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_booking_unit_doctor_start
ON booking_requests(unit_slug, doctor_slug, start_at_ms);

CREATE INDEX IF NOT EXISTS idx_booking_status_confirmby
ON booking_requests(status, confirm_by_ms);
