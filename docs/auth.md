---
title: Autenticação e Identity
---

# Autenticação e Identity

## Fonte de verdade

O monorepo mantém o contrato de Identity em `identity/`. Enquanto o Worker
independente não for promovido, o caminho `/auth/*` é montado pelo Worker de
Inventário como compatibilidade. O monorepo não publica uma interface CRM nem
mantém um proxy Pages para esse produto.

## Sessão

- Sessões usam cookies HttpOnly emitidos pelo contrato de Identity.
- Cada consumidor aplica sua própria política de domínio/host e encaminha
  somente o ator autenticado e seus escopos ao serviço de negócio.
- O dashboard de um produto externo, inclusive o CRM independente, é mantido
  e validado no respectivo repositório.

## Endpoints do contrato

- `POST /auth/login`
- `POST /auth/register` (ou `/auth/signup`)
- `GET /auth/me`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/password/request`
- `POST /auth/password/verify`
- `POST /auth/password/reset`

## Configuração

Secrets, SMTP e valores de sessão permanecem fora do Git e são provisionados
por ambiente. A compatibilidade falha fechado quando a configuração necessária
está ausente; nenhuma rota de autenticação faz fallback para `crm/**`.
