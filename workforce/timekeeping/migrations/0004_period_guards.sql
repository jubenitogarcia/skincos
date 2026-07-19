PRAGMA foreign_keys = ON;

ALTER TABLE timekeeping_events ADD COLUMN work_date TEXT;
UPDATE timekeeping_events
SET work_date = substr(datetime(occurred_at_utc, '-3 hours'), 1, 10)
WHERE work_date IS NULL;
CREATE INDEX IF NOT EXISTS idx_tk_events_work_date
  ON timekeeping_events(employee_id, unit_id, work_date);

CREATE TABLE IF NOT EXISTS timekeeping_period_guards (
  employee_id TEXT NOT NULL REFERENCES workforce_employees(id),
  unit_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CLOSING', 'CLOSED')),
  closure_id TEXT REFERENCES timekeeping_period_closures(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (employee_id, unit_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_tk_period_guards_operation
  ON timekeeping_period_guards(operation_id, status);

CREATE TRIGGER IF NOT EXISTS trg_timekeeping_event_open_period
BEFORE INSERT ON timekeeping_events
WHEN EXISTS (
  SELECT 1
  FROM timekeeping_period_guards g
  WHERE g.employee_id = NEW.employee_id
    AND g.unit_id = NEW.unit_id
    AND g.work_date = COALESCE(NEW.work_date, substr(NEW.occurred_at_utc, 1, 10))
)
BEGIN
  SELECT RAISE(ABORT, 'PERIOD_CLOSED');
END;
