---
title: Runbook Escala
---

# Runbook Escala

## Escopo
- Módulo Escala no CRM (frontend + proxy Pages Functions)
- Worker `escala-api` e banco D1 `skincos-escala`

## Endpoints críticos
- CRM Proxy: `https://crm.skincos.com.br/api/escala/_proxy-status`
- Worker health: `https://escala-api.skincos.com.br/api/escala/health`
- Worker overview: `https://escala-api.skincos.com.br/api/escala/overview`

## Sinais básicos de saúde
1. `_proxy-status` retorna `ok: true`, `targetConfigured: true`, `actorKeyConfigured: true`.
2. `/api/escala/health` retorna 200.
3. `/api/escala/overview` retorna `units` e `months` (pode ser vazio, mas não erro).

## Logs e correlação
- Todos os requests carregam `x-request-id`.
- Workers logs têm eventos `escala.*` e `escala.error`.
- Filtre no Cloudflare Logs com `event: "escala."` ou pelo `x-request-id`.

## Erros comuns e correção rápida
- **401 UNAUTHORIZED / ACTOR_SIGNATURE_INVALID**:
  - Verifique `ESCALA_ACTOR_HMAC_KEY` no Pages Functions e no Worker.
  - Confirme o horário do servidor (skew máximo 5 min).
- **403 FORBIDDEN / FORBIDDEN_UNIT**:
  - Usuário sem role `GESTOR`/`GERENTE`.
  - `allowedUnits` não inclui a unidade solicitada.
- **503 ACTOR_KEY_MISSING / ESCALA_API_TARGET nao configurado**:
  - Secrets ausentes no Pages Functions.

## D1: checagens rápidas
```bash
cd workforce/schedule
npx wrangler d1 execute skincos-escala --remote \
  --command "select count(*) as total from schedule_entries"
```

## Atualização de HMAC (rotina)
1. Gerar segredo novo.
2. Atualizar `ESCALA_ACTOR_HMAC_KEY` no Worker e no Pages Functions.
3. Validar `_proxy-status` e `/api/escala/health`.

## Checklist de validação pós-deploy
1. Acessar CRM com usuário gestor e abrir módulo Escala.
2. Criar escala para uma data e confirmar atualização na lista.
3. Adicionar e remover bloqueio e feriado.
4. Confirmar logs com `x-request-id`.
