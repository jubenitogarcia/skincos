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
- `POST /api/auth/password/request` → envia código ao e-mail cadastrado
- `POST /api/auth/password/verify` → valida o código e retorna um grant efêmero
- `POST /api/auth/password/reset` → troca a senha com o grant e invalida sessões anteriores

## Configuração (produção)

- `SESSION_SECRET` **obrigatório** no Worker Insumos (via `wrangler secret put SESSION_SECRET`).
- Recuperação de senha: `AUTH_RESET_SMTP_HOST`, `AUTH_RESET_SMTP_PORT`,
  `AUTH_RESET_SMTP_USERNAME`, `AUTH_RESET_SMTP_PASSWORD`,
  `AUTH_RESET_EMAIL_FROM` e `AUTH_RESET_CODE_PEPPER`. O Worker falha fechado
  enquanto qualquer um deles estiver ausente; não use `AUTH_RESET_RETURN_TOKEN`.
