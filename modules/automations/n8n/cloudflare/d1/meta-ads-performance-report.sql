CREATE TABLE IF NOT EXISTS entities (
  entity_key TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_name TEXT,
  account_id TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  ad_id TEXT,
  ad_name TEXT,
  creative_id TEXT,
  creative_name TEXT,
  page_id TEXT,
  instagram_user_id TEXT,
  campaign_objective TEXT,
  optimization_goal TEXT,
  destination_type TEXT,
  bid_strategy TEXT,
  billing_event TEXT,
  buying_type TEXT,
  status TEXT,
  effective_status TEXT,
  configured_status TEXT,
  source_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_kind_id
  ON entities(entity_kind, entity_id);

CREATE INDEX IF NOT EXISTS idx_entities_account
  ON entities(account_id, entity_kind);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  metrics_group_key TEXT NOT NULL,
  audit_key TEXT NOT NULL,
  report_date TEXT NOT NULL,
  entity_level TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_name TEXT,
  metrics_window TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value REAL,
  metric_group TEXT NOT NULL,
  analytic_role TEXT NOT NULL,
  value_type TEXT NOT NULL,
  metric_unit TEXT,
  source_kind TEXT NOT NULL,
  source_variant TEXT,
  source_field TEXT,
  source_metric_name TEXT,
  account_currency TEXT,
  dimension_key TEXT NOT NULL DEFAULT '',
  dimensions_json TEXT NOT NULL DEFAULT '{}',
  confidence_status TEXT NOT NULL DEFAULT 'high',
  confidence_score REAL NOT NULL DEFAULT 1,
  warning_codes_json TEXT NOT NULL DEFAULT '[]',
  warning_messages_json TEXT NOT NULL DEFAULT '[]',
  duplicate_source_kinds_json TEXT NOT NULL DEFAULT '[]',
  is_primary INTEGER NOT NULL DEFAULT 1,
  recorded_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_metric_snapshots_primary
  ON metric_snapshots(
    metrics_group_key,
    entity_level,
    entity_id,
    report_date,
    metrics_window,
    metric_name,
    dimension_key,
    dimensions_json
  );

CREATE INDEX IF NOT EXISTS idx_metric_snapshots_query
  ON metric_snapshots(report_date, entity_level, metrics_window, metric_group, analytic_role);

CREATE INDEX IF NOT EXISTS idx_metric_snapshots_entity_window
  ON metric_snapshots(entity_id, metrics_window, metric_name);

CREATE TABLE IF NOT EXISTS ingestion_audit (
  audit_key TEXT PRIMARY KEY,
  metrics_group_key TEXT NOT NULL,
  entity_level TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  report_date TEXT NOT NULL,
  metrics_window TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  api_version TEXT,
  schedule_mode TEXT,
  fetch_status_summary TEXT,
  fetch_status_hourly TEXT,
  fetch_status_breakdown TEXT,
  row_count_summary INTEGER NOT NULL DEFAULT 0,
  row_count_hourly INTEGER NOT NULL DEFAULT 0,
  row_count_breakdown INTEGER NOT NULL DEFAULT 0,
  ingestion_status TEXT NOT NULL,
  payload_hashes_json TEXT NOT NULL DEFAULT '[]',
  raw_payload_references_json TEXT NOT NULL DEFAULT '[]',
  processing_notes_json TEXT NOT NULL DEFAULT '[]',
  warning_codes_json TEXT NOT NULL DEFAULT '[]',
  warning_count INTEGER NOT NULL DEFAULT 0,
  low_confidence_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingestion_audit_report
  ON ingestion_audit(report_date, entity_level, metrics_window, ingestion_status);

CREATE TABLE IF NOT EXISTS raw_payloads (
  payload_hash TEXT PRIMARY KEY,
  request_key TEXT NOT NULL,
  audit_key TEXT NOT NULL,
  metrics_group_key TEXT NOT NULL,
  raw_payload_reference TEXT NOT NULL,
  storage_backend TEXT NOT NULL,
  payload_size_bytes INTEGER NOT NULL DEFAULT 0,
  fetch_status TEXT NOT NULL,
  retrieved_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_payloads_group
  ON raw_payloads(metrics_group_key, audit_key);

CREATE TABLE IF NOT EXISTS metric_duplication_audit (
  duplication_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  metrics_group_key TEXT NOT NULL,
  selection_key TEXT NOT NULL,
  report_date TEXT,
  entity_level TEXT,
  entity_id TEXT,
  metrics_window TEXT,
  dimension_key TEXT,
  metric_name TEXT NOT NULL,
  kept_source_kind TEXT NOT NULL,
  discarded_source_kinds_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metric_duplication_audit_run
  ON metric_duplication_audit(run_id, metrics_group_key, metric_name);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  run_id TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  report_mode TEXT,
  report_date TEXT,
  requested_at TEXT NOT NULL,
  account_id TEXT,
  metrics_group_key TEXT,
  idempotency_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  entities_upserted INTEGER NOT NULL DEFAULT 0,
  metric_snapshots_inserted INTEGER NOT NULL DEFAULT 0,
  audit_rows_inserted INTEGER NOT NULL DEFAULT 0,
  raw_payloads_written INTEGER NOT NULL DEFAULT 0,
  raw_payload_rows_upserted INTEGER NOT NULL DEFAULT 0,
  duplication_rows_upserted INTEGER NOT NULL DEFAULT 0,
  warnings_count INTEGER NOT NULL DEFAULT 0,
  duplication_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  request_headers_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT NOT NULL DEFAULT '{}',
  phase TEXT NOT NULL DEFAULT 'received',
  last_successful_phase TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_request_id TEXT NOT NULL DEFAULT '',
  r2_status TEXT NOT NULL DEFAULT 'not_started',
  d1_status TEXT NOT NULL DEFAULT 'not_started',
  processing_warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_report
  ON ingestion_runs(report_date, status, metrics_group_key);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_idempotency_status
  ON ingestion_runs(idempotency_key, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_phase
  ON ingestion_runs(status, phase, last_successful_phase, updated_at);

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
