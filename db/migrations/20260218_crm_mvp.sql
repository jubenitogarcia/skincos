-- CRM MVP (Postgres) para WhatsApp -> Agendamento
-- Timezone operacional: America/Sao_Paulo (armazenar no app), banco em UTC (timestamptz)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE crm_funnel_status AS ENUM (
    'novo_lead',
    'em_triagem',
    'qualificado',
    'agendamento_sugerido',
    'agendado',
    'confirmado',
    'compareceu',
    'no_show',
    'reagendar',
    'cancelado',
    'reativacao'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE msg_direction AS ENUM ('in', 'out');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE actor_type AS ENUM ('lead', 'bot', 'human', 'system');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL UNIQUE,
  display_name text NULL,
  first_contact_at timestamptz NOT NULL DEFAULT now(),
  last_contact_at timestamptz NULL,
  funnel_status crm_funnel_status NOT NULL DEFAULT 'novo_lead',
  do_not_contact boolean NOT NULL DEFAULT false,
  tags text[] NOT NULL DEFAULT '{}',
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'evolution',
  instance_name text NULL,
  remote_jid text NULL,
  status text NOT NULL DEFAULT 'open', -- open | needs_human | closed
  last_message_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at);

CREATE TABLE IF NOT EXISTS processed_message_ids (
  provider text NOT NULL DEFAULT 'evolution',
  instance_name text NULL,
  provider_message_id text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  workflow_name text NOT NULL,
  PRIMARY KEY (provider, instance_name, provider_message_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  direction msg_direction NOT NULL,
  provider_message_id text NULL,
  message_type text NULL,
  text text NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, created_at);

CREATE TABLE IF NOT EXISTS consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  consent_type text NOT NULL DEFAULT 'lgpd',
  status text NOT NULL DEFAULT 'unknown', -- unknown | granted | revoked
  legal_basis text NULL,
  given_at timestamptz NULL,
  revoked_at timestamptz NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_contact ON consent(contact_id);

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id uuid NULL REFERENCES conversations(id) ON DELETE SET NULL,
  unit_id uuid NULL,
  professional_id uuid NULL,
  status text NOT NULL DEFAULT 'draft', -- draft | proposed | scheduled | confirmed | cancelled | no_show | attended
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  calendar_provider text NOT NULL DEFAULT 'google',
  calendar_id text NULL,
  calendar_event_id text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appt_contact ON appointments(contact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_appt_starts_at ON appointments(starts_at);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NULL REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id uuid NULL REFERENCES conversations(id) ON DELETE SET NULL,
  appointment_id uuid NULL REFERENCES appointments(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_ts timestamptz NOT NULL DEFAULT now(),
  actor actor_type NOT NULL DEFAULT 'system',
  actor_id text NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(event_type, event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_contact_ts ON events(contact_id, event_ts DESC);

-- updated_at helpers
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_contacts_updated
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_conversations_updated
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_appointments_updated
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
