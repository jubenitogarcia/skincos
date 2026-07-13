CREATE TABLE IF NOT EXISTS report_group_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  report_key TEXT NOT NULL,
  report_date TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT,
  group_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  category TEXT NOT NULL,
  route TEXT,
  selection_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  has_subjective INTEGER NOT NULL DEFAULT 0,
  subjective_status TEXT NOT NULL DEFAULT '',
  math_block_json TEXT NOT NULL DEFAULT '{}',
  entities_json TEXT NOT NULL DEFAULT '[]',
  pipeline_audit_json TEXT NOT NULL DEFAULT '{}',
  account_overview_json TEXT NOT NULL DEFAULT '{}',
  delivery_target_json TEXT NOT NULL DEFAULT '{}',
  source_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_group_snapshots_report
  ON report_group_snapshots(report_date, account_id, entity_type, category);

CREATE INDEX IF NOT EXISTS idx_report_group_snapshots_report_key
  ON report_group_snapshots(report_key, group_id);

CREATE TABLE IF NOT EXISTS report_subjective_reviews (
  review_key TEXT PRIMARY KEY,
  report_key TEXT NOT NULL,
  report_date TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT,
  group_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  category TEXT NOT NULL,
  subjective_status TEXT NOT NULL DEFAULT '',
  visual_evidence_status TEXT NOT NULL DEFAULT '',
  overall_subjective_verdict TEXT NOT NULL DEFAULT '',
  recommended_creative_direction TEXT NOT NULL DEFAULT '',
  subjective_summary TEXT NOT NULL DEFAULT '',
  top_risks_json TEXT NOT NULL DEFAULT '[]',
  top_opportunities_json TEXT NOT NULL DEFAULT '[]',
  subjective_scores_json TEXT NOT NULL DEFAULT '{}',
  review_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_subjective_reviews_report
  ON report_subjective_reviews(report_date, account_id, entity_type, category);

CREATE INDEX IF NOT EXISTS idx_report_subjective_reviews_group
  ON report_subjective_reviews(report_key, group_id);

CREATE TABLE IF NOT EXISTS consolidated_reports (
  report_key TEXT PRIMARY KEY,
  report_date TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT,
  message_type TEXT NOT NULL DEFAULT '',
  route TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  headline_math_summary TEXT NOT NULL DEFAULT '',
  sections_json TEXT NOT NULL DEFAULT '[]',
  whatsapp_text TEXT NOT NULL DEFAULT '',
  group_counts_by_category_json TEXT NOT NULL DEFAULT '{}',
  subjective_coverage_json TEXT NOT NULL DEFAULT '{}',
  delivery_target_json TEXT NOT NULL DEFAULT '{}',
  consolidated_groups_count INTEGER NOT NULL DEFAULT 0,
  source_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consolidated_reports_report
  ON consolidated_reports(report_date, account_id, message_type);

CREATE INDEX IF NOT EXISTS idx_consolidated_reports_idempotency
  ON consolidated_reports(idempotency_key, report_date);

CREATE TABLE IF NOT EXISTS report_delivery_audits (
  delivery_key TEXT PRIMARY KEY,
  report_key TEXT NOT NULL,
  report_date TEXT NOT NULL,
  account_id TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL,
  whatsapp_text_length INTEGER NOT NULL DEFAULT 0,
  group_counts_by_category_json TEXT NOT NULL DEFAULT '{}',
  subjective_coverage_json TEXT NOT NULL DEFAULT '{}',
  send_status TEXT NOT NULL DEFAULT '',
  delivery_status TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT NOT NULL DEFAULT '',
  provider_remote_jid TEXT NOT NULL DEFAULT '',
  send_response_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_delivery_audits_report
  ON report_delivery_audits(report_date, account_id, send_status);

CREATE INDEX IF NOT EXISTS idx_report_delivery_audits_idempotency
  ON report_delivery_audits(idempotency_key, report_date);

CREATE TABLE IF NOT EXISTS report_ingestion_runs (
  run_id TEXT NOT NULL,
  report_key TEXT NOT NULL,
  ingestion_kind TEXT NOT NULL,
  report_date TEXT,
  account_id TEXT,
  account_name TEXT,
  idempotency_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  grouped_snapshots_upserted INTEGER NOT NULL DEFAULT 0,
  subjective_reviews_upserted INTEGER NOT NULL DEFAULT 0,
  consolidated_reports_upserted INTEGER NOT NULL DEFAULT 0,
  delivery_audits_upserted INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  summary_json TEXT NOT NULL DEFAULT '{}',
  phase TEXT NOT NULL DEFAULT 'received',
  last_successful_phase TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_request_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_ingestion_runs_report
  ON report_ingestion_runs(report_date, account_id, ingestion_kind, status);

CREATE INDEX IF NOT EXISTS idx_report_ingestion_runs_phase
  ON report_ingestion_runs(status, phase, last_successful_phase, updated_at);
