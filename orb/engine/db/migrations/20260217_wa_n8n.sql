-- SKINCOS WhatsApp (Evolution) -> n8n -> Postgres -> Google Calendar
-- Schema for n8n automations (triage + scheduling)

create extension if not exists "pgcrypto";

create schema if not exists wa_n8n;

create table if not exists wa_n8n.contacts (
    id uuid primary key default gen_random_uuid(),
    phone_e164 text not null,
    phone_raw text,
    push_name text,
    do_not_contact boolean not null default false,
    opted_out_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists wa_n8n_contacts_phone_e164_uq
    on wa_n8n.contacts (phone_e164);

create table if not exists wa_n8n.conversations (
    id uuid primary key default gen_random_uuid(),
    contact_id uuid not null references wa_n8n.contacts(id) on delete cascade,
    unit_slug text not null,
    funnel_status text not null default 'novo_lead',
    triage_step int not null default 0,
    triage_data jsonb not null default '{}'::jsonb,
    needs_human boolean not null default false,
    followup_stage int not null default 0,
    last_message_at timestamptz,
    last_inbound_at timestamptz,
    last_outbound_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists wa_n8n_conversations_contact_unit_uq
    on wa_n8n.conversations (contact_id, unit_slug);

create index if not exists wa_n8n_conversations_status_updated_idx
    on wa_n8n.conversations (funnel_status, updated_at desc);

create table if not exists wa_n8n.messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references wa_n8n.conversations(id) on delete cascade,
    direction text not null,
    provider_message_id text,
    message_type text,
    text text,
    raw_payload jsonb,
    created_at timestamptz not null default now()
);

create unique index if not exists wa_n8n_messages_provider_message_id_uq
    on wa_n8n.messages (provider_message_id)
    where provider_message_id is not null;

create index if not exists wa_n8n_messages_conversation_created_idx
    on wa_n8n.messages (conversation_id, created_at desc);

create table if not exists wa_n8n.events (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid references wa_n8n.conversations(id) on delete set null,
    contact_id uuid references wa_n8n.contacts(id) on delete set null,
    event_type text not null,
    actor text not null default 'system',
    payload jsonb,
    created_at timestamptz not null default now()
);

create index if not exists wa_n8n_events_type_created_idx
    on wa_n8n.events (event_type, created_at desc);

create table if not exists wa_n8n.appointments (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid references wa_n8n.conversations(id) on delete set null,
    contact_id uuid references wa_n8n.contacts(id) on delete set null,
    unit_slug text,
    calendar_id text,
    calendar_event_id text,
    status text not null default 'agendado',
    start_at timestamptz,
    end_at timestamptz,
    timezone text not null default 'America/Sao_Paulo',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists wa_n8n_appointments_start_idx
    on wa_n8n.appointments (start_at);

create table if not exists wa_n8n.consent (
    id uuid primary key default gen_random_uuid(),
    contact_id uuid not null references wa_n8n.contacts(id) on delete cascade,
    do_not_contact boolean not null default false,
    reason text,
    source text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists wa_n8n_consent_contact_idx
    on wa_n8n.consent (contact_id);

create table if not exists wa_n8n.processed_message_ids (
    id uuid primary key default gen_random_uuid(),
    provider text not null default 'evolution',
    provider_message_id text not null,
    received_at timestamptz,
    processed_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create unique index if not exists wa_n8n_processed_message_ids_uq
    on wa_n8n.processed_message_ids (provider_message_id);
