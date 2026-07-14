# Rascunho de Esquema SQL (Fase 2 Persistência)

> Objetivo: Mapear entidades atuais em memória para tabelas PostgreSQL visando migração incremental (dual-write) e suporte multi-tenant.

## Considerações Gerais
- Todas as tabelas terão `tenant_id` (FK lógica) para isolamento.
- Índices focados em buscas por: message_id, contato, timestamps recentes, texto (FTS optional), eventos recentes.
- Campos JSON usados para extensibilidade (ex: annotations metadata, contacts.custom).
- Migração inicial: criar tabelas vazias -> implementar dual-write -> job backfill -> cortar leitura da memória.

## Tabelas

### tenants
```
CREATE TABLE tenants (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### contacts
```
CREATE TABLE contacts (
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id                  TEXT NOT NULL,           -- phone id (E164 digits)
  display_name        TEXT,
  tags                TEXT[] NOT NULL DEFAULT '{}',
  custom              JSONB NOT NULL DEFAULT '{}',
  inbound_count       INT NOT NULL DEFAULT 0,
  outbound_count      INT NOT NULL DEFAULT 0,
  first_seen_at       TIMESTAMPTZ,
  last_inbound_at     TIMESTAMPTZ,
  last_outbound_at    TIMESTAMPTZ,
  last_interaction_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX idx_contacts_last_interaction ON contacts(tenant_id, last_interaction_at DESC);
```

### messages
```
CREATE TYPE message_direction AS ENUM('inbound','outbound');
CREATE TYPE message_type AS ENUM('text','image','video','audio','document','sticker','location','contact');
CREATE TABLE messages (
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id            TEXT NOT NULL,
  contact_id    TEXT,                 -- derivado de to/from sem @c.us
  wa_to         TEXT,
  wa_from       TEXT,
  direction     message_direction NOT NULL,
  type          message_type NOT NULL,
  body          TEXT,
  media_url     TEXT,
  status        TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  annotations   TEXT[] NOT NULL DEFAULT '{}', -- IDs de annotations
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX idx_messages_contact_time ON messages(tenant_id, contact_id, created_at DESC);
CREATE INDEX idx_messages_created_at ON messages(tenant_id, created_at DESC);
-- FTS opcional (Postgres):
-- ALTER TABLE messages ADD COLUMN body_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body,''))) STORED;
-- CREATE INDEX idx_messages_tsv ON messages USING GIN(body_tsv);
```

### message_annotations
```
CREATE TABLE message_annotations (
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id           UUID PRIMARY KEY,
  message_id   TEXT NOT NULL,
  sentiment    TEXT,
  intent       TEXT,
  categories   TEXT[] NOT NULL DEFAULT '{}',
  score        NUMERIC,
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, message_id) REFERENCES messages(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_annotations_message ON message_annotations(tenant_id, message_id);
CREATE INDEX idx_annotations_created ON message_annotations(tenant_id, created_at DESC);
```

### events
```
CREATE TABLE events (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id          UUID PRIMARY KEY,
  type        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_type_time ON events(tenant_id, type, created_at DESC);
CREATE INDEX idx_events_created ON events(tenant_id, created_at DESC);
```

### webhooks
```
CREATE TABLE webhooks (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id          UUID PRIMARY KEY,
  url         TEXT NOT NULL,
  secret_hash TEXT NOT NULL,  -- armazenar hash do secret
  events      TEXT[] NOT NULL DEFAULT '{}',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhooks_active ON webhooks(tenant_id, active);
```

### channels
```
CREATE TABLE channels (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL,
  info        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
```

## Notas de Migração
1. Habilitar tabela `tenants` com registro 'default'.
2. Adicionar camada de repositório (ex: /repositories/*.js) com interfaces: `saveMessage`, `findMessageById`, etc.
3. Implementar dual-write: escrever em memória + banco (feature flag).
4. Criar script de backfill: exportar arrays atuais para insert em lote.
5. Após consistência validada, trocar leituras críticas para banco.
6. Adicionar GC opcional para memória (após migração).

## Segurança & Observabilidade Futuras
- Hash de secrets: `secret_hash = sha256(salt + secret)`.
- Tabela de API Keys (futuro): `api_keys(tenant_id, key_hash, scopes[], last_used_at, revoked)`.
- Métricas Prometheus: contadores por tipo de mensagem, latência webhook, tokens rate-limit.
- Auditing: triggers para registrar mudanças de webhooks/channels.

---
_Rascunho inicial - ajustar conforme evolução das features._
