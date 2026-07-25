-- Canonical Identity account state is additive. The existing status column is
-- retained for operational compatibility: non-ACTIVE access states map to the
-- existing non-operational LEAVE status, while access_state is authoritative
-- for onboarding/authentication gates.
ALTER TABLE workforce_employees ADD COLUMN access_state TEXT;
UPDATE workforce_employees
SET access_state = CASE
  WHEN status = 'TERMINATED' THEN 'TERMINATED'
  WHEN status = 'LEAVE' THEN 'SUSPENDED'
  ELSE 'ACTIVE'
END
WHERE access_state IS NULL;
CREATE INDEX IF NOT EXISTS idx_workforce_employees_access_state ON workforce_employees(access_state, updated_at DESC);
