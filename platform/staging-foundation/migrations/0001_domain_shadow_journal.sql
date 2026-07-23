-- Present independently in every isolated staging D1.
CREATE TABLE IF NOT EXISTS domain_migration_runs (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL CHECK(domain IN ('identity','inventory','finance')),
  source_database TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('shadow','rollback')),
  status TEXT NOT NULL CHECK(status IN ('started','verified','rolled_back','failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS domain_migration_objects (
  run_id TEXT NOT NULL REFERENCES domain_migration_runs(id),
  object_name TEXT NOT NULL,
  classification TEXT NOT NULL CHECK(classification IN ('non_personal','sanitized','withheld_sensitive')),
  action TEXT NOT NULL CHECK(action IN ('copied','reconciled','withheld','fixture')),
  source_count INTEGER NOT NULL,
  target_count INTEGER NOT NULL,
  source_checksum TEXT,
  target_checksum TEXT,
  verified_at TEXT NOT NULL,
  PRIMARY KEY(run_id,object_name)
);
