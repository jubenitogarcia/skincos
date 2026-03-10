-- Booking customers + extra fields
-- Apply with:
--   wrangler d1 migrations apply espacofacial-booking

ALTER TABLE booking_requests ADD COLUMN customer_email TEXT;
ALTER TABLE booking_requests ADD COLUMN customer_cpf TEXT;
ALTER TABLE booking_requests ADD COLUMN customer_address TEXT;
ALTER TABLE booking_requests ADD COLUMN customer_id TEXT;

CREATE TABLE IF NOT EXISTS booking_customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    cpf TEXT,
    address TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_customers_email
ON booking_customers(email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_customers_cpf
ON booking_customers(cpf);
