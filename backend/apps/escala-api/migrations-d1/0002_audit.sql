ALTER TABLE schedule_entries ADD COLUMN created_by TEXT;
ALTER TABLE schedule_entries ADD COLUMN updated_by TEXT;
ALTER TABLE schedule_entries ADD COLUMN updated_at TEXT;

ALTER TABLE closed_days ADD COLUMN created_by TEXT;
ALTER TABLE closed_days ADD COLUMN updated_by TEXT;
ALTER TABLE closed_days ADD COLUMN updated_at TEXT;

ALTER TABLE holidays ADD COLUMN created_by TEXT;
ALTER TABLE holidays ADD COLUMN updated_by TEXT;
ALTER TABLE holidays ADD COLUMN updated_at TEXT;
