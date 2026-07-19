PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS timekeeping_audit_head (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  hash TEXT
);
INSERT OR IGNORE INTO timekeeping_audit_head (id, hash)
VALUES (1, (SELECT hash FROM timekeeping_audit_events ORDER BY occurred_at DESC, id DESC LIMIT 1));

CREATE TRIGGER IF NOT EXISTS trg_timekeeping_audit_chain_before_insert
BEFORE INSERT ON timekeeping_audit_events
WHEN COALESCE(NEW.prev_hash, '') <> COALESCE((SELECT hash FROM timekeeping_audit_head WHERE id=1), '')
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_CHAIN_CONFLICT');
END;

CREATE TRIGGER IF NOT EXISTS trg_timekeeping_audit_chain_after_insert
AFTER INSERT ON timekeeping_audit_events
BEGIN
  UPDATE timekeeping_audit_head SET hash=NEW.hash WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS trg_timekeeping_audit_immutable_update
BEFORE UPDATE ON timekeeping_audit_events
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_timekeeping_audit_immutable_delete
BEFORE DELETE ON timekeeping_audit_events
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
END;
