# Escala API (Cloudflare Worker)

Serviço de escala rodando em Cloudflare Workers com D1.

## Deploy
```
cd workforce/schedule
npx wrangler deploy --env ""
```

## D1
- Banco: `skincos-escala`
- Migrações: `migrations-d1/`

Aplicar migrações:
```
wrangler d1 migrations apply skincos-escala --remote
```

Seed:
```
wrangler d1 execute skincos-escala --remote --file=seed/escala_seed.sql
```
Ou:
```
./scripts/seed-remote.sh          # produção
./scripts/seed-remote.sh staging  # staging
```

## Endpoints
- `GET /api/escala/overview`
- `GET /api/escala/professionals?unit=...`
- `POST /api/escala/professionals`
- `PUT /api/escala/professionals`
- `GET /api/escala/schedule?unit=...&month=YYYY-MM`
- `POST /api/escala/schedule` (add)
- `PUT /api/escala/schedule` (replace day)
- `DELETE /api/escala/schedule` (remove)
- `POST /api/escala/closed-days`
- `DELETE /api/escala/closed-days`
- `POST /api/escala/holidays`
- `DELETE /api/escala/holidays`
- `GET /health`

## Vars
- `APP_ORIGIN` (CORS)
- `ESCALA_ACTOR_HMAC_KEY` (auth)

## Auth (CRM proxy)
Os endpoints `/api/escala/*` exigem headers assinados:
- `x-crm-user` (base64url JSON do ator)
- `x-crm-ts` (timestamp ms)
- `x-crm-signature` (HMAC SHA-256 de `${ts}.${payload}`)

## Invariantes do módulo
- `Equipe` vem de `professionals` por unidade; não depende do mês ter escala montada.
- `schedule_entries` complementa a agenda do mês, mas não substitui o cadastro de equipe.
- Falha em `professionals` deve aparecer como erro operacional, nunca como “equipe vazia”.
- Toda mudança de schema da Escala precisa passar por migration aplicada antes do deploy.

## Smoke funcional
Smoke autenticado do worker:
```
ESCALA_ACTOR_HMAC_KEY=... node ./scripts/smoke.mjs
```

Variáveis opcionais:
- `ESCALA_SMOKE_BASE_URL` (`https://escala-api.skincos.com.br` por padrão)
- `ESCALA_SMOKE_UNIT`
- `ESCALA_SMOKE_MONTH`

O smoke valida:
- `GET /api/escala/overview`
- `GET /api/escala/professionals?unit=...`
- `GET /api/escala/schedule?unit=...&month=...`

## Runbook curto
### Sintoma: Equipe vazia em mês sem escala
1. Rodar o smoke funcional do worker.
2. Verificar se `GET /api/escala/professionals` retorna `200` e payload válido.
3. Verificar migrations remotas:
   - `wrangler d1 migrations apply skincos-escala --remote`
4. Se o worker estiver saudável e `professionals` falhar, revisar schema drift e logs `escala.error`.

### Sintoma: erro de autenticação
1. Verificar se `ESCALA_ACTOR_HMAC_KEY` está sincronizada no Pages proxy e no worker.
2. Validar timestamp/assinatura via smoke.
3. Revisar respostas `401 UNAUTHORIZED` e `403 FORBIDDEN` nos logs do worker.

## Leitura pública privada para Website

O contrato [schedule-public-read/v1](PUBLIC_READ_CONTRACT.md) usa adapter
privado e HMACs separados do acesso de gestão. A projeção inclui apenas
profissionais explicitamente ativos com papel Injetor e unidade comprovada;
os IDs vêm do cadastro existente, com quatro aliases públicos exatos.
Lista e disponibilidade aplicam a mesma elegibilidade. Referência órfã no
dia/unidade consultados falha de forma explícita, sem alterar o histórico.

A rota continua desabilitada na configuração fonte. A ativação exige a
publicação governada, readback do deployment e prova do DTO para ambas as
unidades; /health ou /readiness isolados não bastam. A publicação nativa manual
usa os novos scripts public-read-native-* e seus manifests/receipts próprios,
com custódia e lease reais. Os comandos de gestão acima não substituem essa
autoridade nem permitem reusar IDs/provas de workflows.

A projeção, o adapter e o probe têm testes inteiramente sintéticos em
public-read-projection.test.js, public-read-core.test.js,
public-read-worker.test.js e public-read-projection-probe.test.js. Operações de
projeto e esses testes devem passar pelo gateway tipado do repositório.
