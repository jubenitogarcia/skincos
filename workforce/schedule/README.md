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


### Atualizações e reativação do adapter nativo

O bootstrap continua exclusivo para Worker ausente. Cada ciclo usa um manifest e
releaseId novos, no mesmo diretório privado de recibos. Nunca exclua o Worker ou
seu namespace para repetir bootstrap, nem remova diretórios/claims de operação.

- Primeira publicação: adapter-bootstrap-disabled → core-enable → adapter-enable.
- Worker existente: prepare o manifest com --predecessor-release-id,
  --predecessor-operation (adapter-enable, adapter-disable, adapter-bootstrap-disabled
  ou adapter-reconcile-disable)
  e --predecessor-manifest-sha256, apontando ao predecessor terminal atual.
  Execute adapter-disable → core-enable → adapter-enable no novo release.
- Após uma desativação, use outro releaseId com o recibo adapter-disable como
  predecessor e siga a mesma sequência. Não reabra uma operação já reservada.

O manifest inclui os digests de manifest/recibo anteriores, source/tree/config,
versão, deployment, modo e namespace. Antes da escrita, o publisher reconfere a
cadeia completa e o estado ativo exato. A ativação aceita um único bootstrap ou
disable concluído do release atual; o probe e a privacidade continuam obrigatórios.
Cada versão consumida tem claim exclusivo entre releases no mesmo ledger privado.
Uma tentativa started/unknown mantém sua reserva e impede que novo releaseId repita
a escrita usando o predecessor ainda ativo. Interrompa para readback e reconciliação
sob a autoridade aplicável; este fluxo não fornece retry cego nem remoção de claims.


Se adapter-enable registrou o readback ready exato mas falhou depois (por exemplo,
no probe), adapter-reconcile-disable usa o mesmo manifest elegível e outro diretório
exclusivo de operação. Exige cadeia íntegra da ativação sem recibo terminal, o
readback ready já registrado, versão/deployment ainda ativos e namespace igual ao
bootstrap/disable concluído. Publica apenas o modo reconciled-disabled sob o mesmo
lease de adapter, com tag própria; não aprova nem repete a ativação. Seu recibo de
desativação pode ser predecessor de um ciclo posterior. Sem readback ready registrado,
a operação falha fechada; respostas incertas não autorizam retry.
