-- Music Composition Studio: additive, inactive-by-default PostgreSQL ledger.
-- IDs are supplied by the orchestrator so this migration needs no extension.
begin;

create schema if not exists music_studio;

create table if not exists music_studio.music_productions (
  production_id text primary key,
  composition_id text not null,
  production_tier text not null,
  status text not null,
  revision integer not null default 1 check (revision > 0),
  input_hash text not null,
  constitution_hash text,
  dry_run boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists music_studio.music_constitutions (
  constitution_id text primary key,
  production_id text not null references music_studio.music_productions(production_id),
  revision integer not null check (revision > 0),
  lock_hash text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (production_id, revision),
  unique (production_id, lock_hash)
);

create table if not exists music_studio.music_jobs (
  job_key text primary key,
  production_id text not null references music_studio.music_productions(production_id),
  module text not null,
  component_id text not null,
  revision integer not null check (revision > 0),
  input_hash text not null,
  result_hash text,
  status text not null,
  provider text,
  provider_request_id text,
  model text,
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null default 1 check (max_attempts > 0),
  next_retry_at timestamptz,
  fallback_provider text,
  invalidation_reason text,
  cost numeric(12,4) not null default 0 check (cost >= 0),
  error_code text,
  error_message text,
  lineage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (production_id, module, component_id, revision, input_hash)
);

create table if not exists music_studio.music_artifacts (
  artifact_id text primary key,
  production_id text not null references music_studio.music_productions(production_id),
  uri text not null,
  checksum text not null,
  kind text not null,
  status text not null default 'COMPLETED',
  approved boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  lineage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (production_id, checksum)
);

create table if not exists music_studio.music_dependencies (
  production_id text not null references music_studio.music_productions(production_id),
  component_id text not null,
  depends_on_component_id text not null,
  dependency_hash text not null,
  invalidated_at timestamptz,
  invalidation_reason text,
  created_at timestamptz not null default now(),
  primary key (production_id, component_id, depends_on_component_id)
);

create table if not exists music_studio.music_candidates (
  candidate_id text primary key,
  production_id text not null references music_studio.music_productions(production_id),
  candidate_type text not null,
  revision integer not null default 1 check (revision > 0),
  score numeric(6,4),
  payload jsonb not null,
  lineage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists music_studio.music_composition_dna (
  composition_dna_id text primary key,
  production_id text not null references music_studio.music_productions(production_id),
  revision integer not null default 1 check (revision > 0),
  compatibility_score numeric(6,4) not null,
  payload jsonb not null,
  lineage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists music_studio.music_sections (
  section_id text primary key,
  production_id text not null references music_studio.music_productions(production_id),
  section_type text not null,
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists music_studio.music_stems (
  stem_job_id text primary key,
  production_id text not null references music_studio.music_productions(production_id),
  section_id text not null,
  role text not null,
  artifact_id text,
  revision integer not null default 1 check (revision > 0),
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists music_studio.music_arrangements (
  arrangement_id text primary key,
  production_id text not null references music_studio.music_productions(production_id),
  revision integer not null default 1 check (revision > 0),
  lock_hash text not null,
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists music_studio.music_mix_versions (
  mix_id text primary key,
  production_id text not null references music_studio.music_productions(production_id),
  revision integer not null default 1 check (revision > 0),
  lock_hash text not null,
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists music_studio.music_master_versions (
  master_id text primary key,
  production_id text not null references music_studio.music_productions(production_id),
  revision integer not null default 1 check (revision > 0),
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists music_studio.music_qa_reports (
  qa_id text primary key,
  production_id text not null references music_studio.music_productions(production_id),
  candidate_id text,
  decision text not null,
  score numeric(6,4),
  report jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists music_studio.music_provider_events (
  event_id text primary key,
  production_id text not null references music_studio.music_productions(production_id),
  job_key text,
  provider text not null,
  provider_request_id text,
  event_type text not null,
  model text,
  attempt integer not null default 0 check (attempt >= 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_request_id, event_type)
);

create table if not exists music_studio.music_cost_events (
  event_id text primary key,
  production_id text not null references music_studio.music_productions(production_id),
  job_key text,
  provider text not null,
  model text,
  amount numeric(12,4) not null check (amount >= 0),
  currency text not null default 'USD',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists music_studio.music_reference_analyses (
  analysis_id text primary key,
  production_id text not null references music_studio.music_productions(production_id),
  reference_id text not null,
  rights_status text not null,
  reference_usage_scope text not null,
  similarity_risk numeric(6,4) check (similarity_risk between 0 and 1),
  analysis jsonb not null,
  created_at timestamptz not null default now(),
  unique (production_id, reference_id)
);

create index if not exists music_jobs_pending_idx
  on music_studio.music_jobs (status, next_retry_at);
create index if not exists music_jobs_provider_request_idx
  on music_studio.music_jobs (provider, provider_request_id);
create index if not exists music_artifacts_production_kind_idx
  on music_studio.music_artifacts (production_id, kind, approved);
create index if not exists music_provider_events_request_idx
  on music_studio.music_provider_events (provider, provider_request_id);
create index if not exists music_cost_events_production_idx
  on music_studio.music_cost_events (production_id, created_at);

commit;
