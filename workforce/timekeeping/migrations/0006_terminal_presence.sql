PRAGMA foreign_keys = ON;

-- A registered terminal is the authoritative presence channel. Network and
-- mobile-location evidence is deliberately stored separately from the event so
-- the immutable event ledger never needs raw IP addresses or coordinates.
ALTER TABLE timekeeping_devices ADD COLUMN device_mode TEXT NOT NULL DEFAULT 'TERMINAL' CHECK (device_mode IN ('TERMINAL', 'MOBILE'));
ALTER TABLE timekeeping_devices ADD COLUMN network_policy TEXT NOT NULL DEFAULT 'NONE' CHECK (network_policy IN ('NONE', 'OBSERVE', 'REQUIRE'));
ALTER TABLE timekeeping_devices ADD COLUMN allowed_networks_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS timekeeping_unit_presence_policies (
  unit_id TEXT PRIMARY KEY,
  presence_mode TEXT NOT NULL DEFAULT 'FLEXIBLE' CHECK (presence_mode IN ('TERMINAL_REQUIRED', 'EXTERNAL_REVIEW', 'FLEXIBLE')),
  geofence_latitude REAL,
  geofence_longitude REAL,
  geofence_radius_meters INTEGER NOT NULL DEFAULT 150 CHECK (geofence_radius_meters BETWEEN 25 AND 5000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timekeeping_punch_evidence (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES timekeeping_events(id),
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('TERMINAL_DEVICE', 'NETWORK_CONTEXT', 'LOCATION')),
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, evidence_type)
);
CREATE INDEX IF NOT EXISTS idx_tk_punch_evidence_event ON timekeeping_punch_evidence(event_id, evidence_type);
