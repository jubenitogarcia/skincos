# Agendamento — Setup Cloudflare D1 + Token (produção e preview)

Este projeto usa **Cloudflare D1** para persistir pedidos de agendamento (MVP) via binding `BOOKING_DB`.

## 1) Pré-requisitos

- Wrangler instalado (já está no `devDependencies`)
- Login na conta Cloudflare:

```bash
wrangler login
```

## 2) Criar o banco D1

Crie o banco (uma única vez):

```bash
wrangler d1 create espacofacial-booking
```

O comando vai imprimir um `database_id`. Copie esse valor.

## 3) Atualizar binding no `wrangler.toml`

Edite o arquivo para colocar o ID real:

- `database_name = "espacofacial-booking"`
- `database_id = "<SEU_DATABASE_ID>"`

Arquivo: `wrangler.toml`

## 4) Rodar a migration (recomendado)

A migration está em `migrations/0001_booking_requests.sql`.

Aplicar no banco **remoto (produção)**:

```bash
wrangler d1 execute espacofacial-booking --remote --file migrations/0001_booking_requests.sql
```

Notas:
- O app também tem `ensureSchema()` em `src/lib/bookingDb.ts`, então a tabela pode ser criada automaticamente em runtime.
- Mesmo assim, rodar a migration é recomendado para manter o estado do banco explícito e repetível.

## 5) Rodar em preview local (com D1)

Para testar o agendamento localmente com o ambiente Cloudflare (bindings + secrets), use:

```bash
npm run preview
```

## 6) (Recomendado) Confirmar/recusar sem token via links assinados

Para operar 100% via WhatsApp (cliente final) sem expor token de painel, use links assinados:

- Configure o secret:

```bash
wrangler secret put BOOKING_DECISION_SECRET
```

O endpoint gera links como:
- `/api/booking/decision?...` (confirm/decline)

Esses links expiram no mesmo prazo do SLA (`confirmByMs`).

## 7) (Opcional) Webhook de automação (WhatsApp)

Se você tem um serviço próprio/integração que manda WhatsApp, configure um webhook para receber o JSON do pedido:

```bash
wrangler secret put BOOKING_WEBHOOK_URL
wrangler secret put BOOKING_WEBHOOK_SECRET
```

O Worker fará um POST `booking.created` com os dados e `decisionLinks`.

### Placeholder para resposta via webhook (confirmar/recusar)

Já existe um endpoint para seu sistema confirmar/recusar via POST (útil quando você tiver um servidor que envia WhatsApp e recebe as respostas):

- `POST /api/booking/webhook/decision`

Ele fica **desabilitado** até você configurar `BOOKING_WEBHOOK_SECRET`.


## 8) Deploy

Depois do D1 + secret configurados:

```bash
npm run deploy
```

## 9) Nota sobre painel interno

O painel interno (UI de confirmações) e as rotas `/api/booking/admin/*` foram removidos para reduzir superfície pública.

Operação recomendada:
- WhatsApp + links assinados (`BOOKING_DECISION_SECRET`)
- (Opcional) webhook de automação (`BOOKING_WEBHOOK_URL` + `BOOKING_WEBHOOK_SECRET`)
