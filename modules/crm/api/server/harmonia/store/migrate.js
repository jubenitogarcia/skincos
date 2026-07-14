import { defaultWorkingHoursForUnitSlug } from '../util/workingHours.js'

export function harmoniaMigrationStatements() {
    return [
        `create extension if not exists pgcrypto;`,
        `create schema if not exists harmonia;`,

        `create table if not exists harmonia.units (
            id uuid primary key default gen_random_uuid(),
            slug text unique not null,
            name text not null,
            timezone text not null default 'America/Sao_Paulo',
            working_hours jsonb not null default '{}'::jsonb,
            notify_remote_jid text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        );`,

        `create table if not exists harmonia.contacts (
            id uuid primary key default gen_random_uuid(),
            wa_jid text,
            phone_raw text not null,
            display_name text,
            opted_out_at timestamptz,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique(phone_raw)
        );`,

        `create table if not exists harmonia.conversations (
            id uuid primary key default gen_random_uuid(),
            unit_id uuid not null references harmonia.units(id) on delete cascade,
            contact_id uuid not null references harmonia.contacts(id) on delete cascade,
            stage text not null default 'new',
            last_inbound_at timestamptz,
            last_outbound_at timestamptz,
            procedure_code text,
            procedure_confidence numeric,
            lead_speed_class text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique(unit_id, contact_id)
        );`,
        `create index if not exists harmonia_conversations_unit_updated_at_idx on harmonia.conversations(unit_id, updated_at desc);`,

        `create table if not exists harmonia.messages (
            id uuid primary key default gen_random_uuid(),
            conversation_id uuid not null references harmonia.conversations(id) on delete cascade,
            direction text not null,
            provider_message_id text not null,
            text text,
            raw jsonb,
            created_at timestamptz not null default now(),
            unique(conversation_id, provider_message_id)
        );`,
        `create index if not exists harmonia_messages_conversation_created_at_idx on harmonia.messages(conversation_id, created_at desc);`,

        `create table if not exists harmonia.tasks (
            id uuid primary key default gen_random_uuid(),
            type text not null,
            run_at timestamptz not null,
            conversation_id uuid not null references harmonia.conversations(id) on delete cascade,
            payload jsonb,
            status text not null default 'pending',
            attempts int not null default 0,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        );`,

        `create index if not exists harmonia_tasks_status_run_at_idx on harmonia.tasks(status, run_at);`,
        `alter table harmonia.tasks add column if not exists locked_at timestamptz;`,
        `alter table harmonia.tasks add column if not exists last_error text;`,

        `create table if not exists harmonia.delivery_events (
            id uuid primary key default gen_random_uuid(),
            conversation_id uuid not null references harmonia.conversations(id) on delete cascade,
            provider_message_id text not null,
            status text not null,
            error text,
            raw jsonb,
            created_at timestamptz not null default now(),
            unique(conversation_id, provider_message_id)
        );`,
        `create index if not exists harmonia_delivery_events_status_idx on harmonia.delivery_events(status);`,
    ]
}

export function defaultUnitsSeedRows() {
    return [
        {
            slug: 'novo_hamburgo',
            name: 'Espaço Facial - Novo Hamburgo',
            timezone: 'America/Sao_Paulo',
            working_hours: defaultWorkingHoursForUnitSlug('novo_hamburgo'),
        },
        {
            slug: 'barra_shopping',
            name: 'Espaço Facial - BarraShoppingSul',
            timezone: 'America/Sao_Paulo',
            working_hours: defaultWorkingHoursForUnitSlug('barra_shopping'),
        },
    ]
}
