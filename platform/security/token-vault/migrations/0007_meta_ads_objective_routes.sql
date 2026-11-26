-- Rotas por objetivo do Meta Ads (objroute_v1): pedido de campanha + conjunto
-- PAUSADOS, aprovação e ativação com teto mensal por unidade.
--
-- Migration só aditiva: cria quatro tabelas novas e nenhum ALTER em tabelas
-- existentes. As rotas ficam desligadas até META_ADS_OBJECTIVE_ROUTES_MODE=on,
-- então aplicar esta migration antes do Worker novo não muda nada em produção.
-- A trava por unidade usa a tabela meta_ads_publish_locks já existente.

-- Política por unidade (teto duro do mês, perfil do mês e público). Só o papel
-- admin grava. Os valores ficam aqui, fora do repositório e do workflow.
CREATE TABLE IF NOT EXISTS meta_ads_objective_route_policies (
  unit TEXT PRIMARY KEY CHECK(unit IN ('BSS', 'NH')),
  token_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  policy_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Um registro por pedido de rota. A mesma route_key pode ter vários registros
-- ao longo do tempo (pedido novo depois de recusa, bloqueio ou vencimento),
-- mas só um aberto por vez.
CREATE TABLE IF NOT EXISTS meta_ads_objective_routes (
  id TEXT PRIMARY KEY,
  route_key TEXT NOT NULL,
  unit TEXT NOT NULL CHECK(unit IN ('BSS', 'NH')),
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'CREATING', 'PENDING_APPROVAL', 'ACTIVATING', 'ACTIVATED',
    'REJECTED', 'BLOCKED', 'EXPIRED', 'PAUSED_BY_MONITOR'
  )),
  approval_code TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL DEFAULT '{}',
  token_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  daily_budget_minor_units INTEGER NOT NULL CHECK(daily_budget_minor_units > 0),
  campaign_name TEXT NOT NULL,
  adset_name TEXT NOT NULL,
  campaign_id TEXT,
  adset_id TEXT,
  campaign_status TEXT,
  adset_status TEXT,
  decision TEXT,
  decision_json TEXT NOT NULL DEFAULT '{}',
  reply_message_id TEXT,
  reply_ts INTEGER,
  pending_at TEXT,
  expires_at TEXT,
  decided_at TEXT,
  request_notified_at TEXT,
  decision_notified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_objective_routes_key_created
  ON meta_ads_objective_routes(route_key, created_at);
CREATE INDEX IF NOT EXISTS idx_meta_ads_objective_routes_unit_status
  ON meta_ads_objective_routes(unit, status);

-- Só um registro vivo por route_key (idempotência da criação e da ativação).
CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_ads_objective_routes_live_key
  ON meta_ads_objective_routes(route_key)
  WHERE status IN ('CREATING', 'PENDING_APPROVAL', 'ACTIVATING', 'ACTIVATED');

-- Código de aprovação único entre as pendências abertas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_ads_objective_routes_open_code
  ON meta_ads_objective_routes(approval_code)
  WHERE status IN ('CREATING', 'PENDING_APPROVAL', 'ACTIVATING');

-- A mesma resposta do operador nunca decide duas rotas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_ads_objective_routes_reply
  ON meta_ads_objective_routes(reply_message_id)
  WHERE reply_message_id IS NOT NULL;

-- Journal: toda tentativa e todo resultado de mutação na Graph, em ordem.
CREATE TABLE IF NOT EXISTS meta_ads_objective_route_events (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL,
  route_key TEXT NOT NULL,
  event TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_objective_route_events_route
  ON meta_ads_objective_route_events(route_id, created_at);

-- Leitura de gasto e orçamentos da conta, guardada por poucos minutos para a
-- lista de pendências. A decisão de ativar nunca usa este cache.
CREATE TABLE IF NOT EXISTS meta_ads_objective_route_snapshots (
  account_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  as_of TEXT NOT NULL
);
