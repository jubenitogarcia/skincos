-- CCG v2 ledger. Apply only to the isolated/test n8n database first.
create table if not exists content_productions (
  production_id text primary key,
  content_id text not null,
  campaign_id text not null,
  status text not null,
  input_hash text not null,
  output_hash text,
  dry_run integer not null default 1,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);
create table if not exists production_jobs (
  job_key text primary key,
  production_id text not null references content_productions(production_id),
  module text not null,
  component_id text not null,
  revision integer not null,
  status text not null,
  input_hash text not null,
  output_hash text,
  provider text,
  provider_request_id text,
  cost real not null default 0,
  attempt integer not null default 0,
  error_code text,
  error_message text,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp,
  unique (production_id, module, component_id, revision)
);
create table if not exists production_artifacts (
  artifact_id text primary key,
  production_id text not null references content_productions(production_id),
  uri text not null,
  checksum text not null,
  mime_type text,
  status text not null,
  metadata_json text not null default '{}',
  created_at text not null default current_timestamp
);
create table if not exists production_dependencies (
  production_id text not null,
  job_key text not null,
  dependency_job_key text not null,
  dependency_hash text not null,
  primary key (production_id, job_key, dependency_job_key)
);
create table if not exists qa_reports (
  qa_id text primary key,
  production_id text not null references content_productions(production_id),
  status text not null,
  score real not null,
  blocking_issues_json text not null default '[]',
  report_json text not null,
  created_at text not null default current_timestamp
);
create table if not exists provider_events (
  event_id text primary key,
  production_id text not null,
  job_key text,
  provider text not null,
  provider_request_id text,
  event_type text not null,
  payload_json text not null,
  created_at text not null default current_timestamp
);
