-- Keep professional_name as the historical/display compatibility field.
ALTER TABLE professionals ADD COLUMN workforce_employee_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_professionals_workforce_employee
  ON professionals(workforce_employee_id)
  WHERE workforce_employee_id IS NOT NULL AND trim(workforce_employee_id) <> '';

ALTER TABLE schedule_entries ADD COLUMN professional_id TEXT;
CREATE INDEX IF NOT EXISTS idx_schedule_entries_professional_id
  ON schedule_entries(professional_id);
