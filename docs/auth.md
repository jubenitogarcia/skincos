---
title: Autenticação (CRM)
---

# Autenticação (CRM)

## Source of truth

O CRM usa **apenas um backend de autenticação**:
- **Insumos Worker** (`api.skincos.com.br/insumos`) nas rotas `GET/POST /auth/*`

O frontend (Cloudflare Pages) expõe um proxy estável:
- `crm.skincos.com.br/api/auth/*` → `api.skincos.com.br/insumos/auth/*`

## Sessão

- Sessão é via **cookies HttpOnly** (`session`, `csrfToken`) emitidos pelo Worker.
- Em `crm.skincos.com.br`, o proxy Pages preserva múltiplos `Set-Cookie` e remove `Domain=` para cookies host-only.
- O dashboard só monta após a verificação determinística de sessão (`/api/auth/me`).

## Endpoints (principais)

- `POST /api/auth/login` → cria sessão
- `POST /api/auth/register` → cria conta + sessão
- `GET /api/auth/me` → retorna usuário + renova cookies
- `POST /api/auth/logout` → encerra sessão

## Configuração (produção)

- `SESSION_SECRET` **obrigatório** no Worker Insumos (via `wrangler secret put SESSION_SECRET`).
