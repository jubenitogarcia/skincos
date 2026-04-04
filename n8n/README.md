# SKINCOS · WhatsApp (Evolution) → n8n → Postgres → Google Calendar

Este módulo adiciona workflows n8n + schema Postgres para triagem, agendamento e reativação de leads via WhatsApp (Evolution API).

## Estrutura
- Workflows n8n: `n8n/workflows`
- Migrations Postgres: `db/migrations/20260217_wa_n8n.sql`

## Variáveis de ambiente (não commitar segredos)
- `EVOLUTION_BASE_URL=`
- `EVOLUTION_INSTANCE_NAME=`
- `EVOLUTION_API_KEY=`
- `N8N_PUBLIC_BASE_URL=`
- `DATABASE_URL=postgres://...`

Valores recomendados para o stack público atual:
- `EVOLUTION_BASE_URL=https://wa.skincos.com.br`
- `N8N_PUBLIC_BASE_URL=https://orb.skincos.com.br`
- `GOOGLE_REDIRECT_URI=https://orb.skincos.com.br/rest/oauth2-credential/callback`

Para desenvolvimento exclusivamente local, você ainda pode sobrescrever para `http://localhost:8080` e `http://localhost:5678`.

Google Calendar (OAuth2):
- `GOOGLE_CLIENT_ID=`
- `GOOGLE_CLIENT_SECRET=`
- `GOOGLE_REDIRECT_URI=` (conforme n8n)
- `GOOGLE_CALENDAR_ID_*` (a definir)

## Variáveis adicionais do módulo (n8n)
Copie `n8n/.env.example` para seu ambiente do n8n e ajuste:
- `N8N_DEFAULT_UNIT_SLUG`
- `N8N_DEFAULT_UNIT_NAME`
- `N8N_UNIT_NAME_MAP`
- `N8N_HANDOFF_NOTIFY_NUMBER`
- `GOOGLE_CALENDAR_ID`
- `N8N_DEFAULT_TEST_PHONE` (fallback em dev)

Meta Ads - Performance Report:
- `META_ADS_ACCOUNT_ID`
- `META_ADS_API_VERSION`
- `META_ADS_ACCESS_TOKEN`
- `META_ADS_REPORT_MODE`
- `META_ADS_REPORT_ENVIRONMENT`
- `META_ADS_REPORT_STORAGE_MODE`
- `META_ADS_REPORT_WORKER_BASE_URL`
- `META_ADS_REPORT_WORKER_PERSIST_PATH`
- `META_ADS_REPORT_WORKER_AUTH_HEADER`
- `META_ADS_REPORT_WORKER_AUTH_SCHEME`
- `META_ADS_REPORT_WORKER_API_TOKEN`
- `META_ADS_REPORT_WORKER_TIMEOUT_MS`
- `META_ADS_REPORT_D1_DATABASE_NAME`
- `META_ADS_REPORT_R2_BUCKET_NAME`
- `META_ADS_REPORT_RAW_PAYLOADS_ENABLED`
- `META_ADS_REPORT_COMPAT_EXPORT_ENABLED`
- `META_ADS_REPORT_COMPAT_EXPORT_TARGET`

## Credenciais a criar no n8n
1. **Postgres**
   - Nome esperado nos workflows: `Postgres (Skincos)`
   - Use o mesmo `DATABASE_URL` do ambiente de backend.

2. **Google Calendar (OAuth2)**
   - Nome esperado nos workflows: `Google Calendar (Skincos)`
   - O `calendarId` é configurado via `GOOGLE_CALENDAR_ID`.

## Endpoints esperados (n8n)
- Produção: `POST /webhook/wa/inbound/evolution`
- Teste: `POST /webhook-test/wa/inbound/evolution`

Configure a Evolution API para apontar para esse endpoint.

## Formato do webhook Evolution (referência real do repo)
O parser do workflow segue o formato esperado em `backend/apps/crm-api/server/harmonia/routes.js`:

```json
{
  "body": {
    "instance": "skincos",
    "data": {
      "key": { "remoteJid": "557499879409@s.whatsapp.net", "fromMe": false, "id": "ABC1234" },
      "pushName": "Davidson",
      "message": { "conversation": "Qual o seu nome?" },
      "messageType": "conversation",
      "messageTimestamp": 1700000000
    }
  }
}
```
Obs.: o parser também aceita payload “flat” (sem `body.data`) para testes locais.

## Workflows
1. **WORKFLOW_01_INBOUND_TRIAGEM.json**
   - Webhook inbound
   - Idempotência (`processed_message_ids`)
   - Opt-out e handoff humano
   - Triagem e status do funil

2. **WORKFLOW_02_AGENDAMENTO.json**
   - Proposta de 3 horários
   - Confirmação de escolha (1/2/3)
   - Criação de evento no Google Calendar

3. **WORKFLOW_03_LEMBRETES_E_CONFIRMACAO.json**
   - Cron 15 min
   - Lembretes 24h e 2h
   - Follow-ups de silêncio (15min, 24h, 72h)

4. **WORKFLOW_04_NOSHOW_REATIVACAO.json**
   - Cron diário
   - Marca no-show e dispara reativação

## Importação
No n8n, importe cada JSON (1 workflow por arquivo) no editor.

## Tabelas
Criar via migrations em `db/migrations`.

## Setup rápido
1. Rodar migration:

```bash
psql "$DATABASE_URL" -f db/migrations/20260217_wa_n8n.sql
```

2. Importar workflows no n8n:
- `WORKFLOW_01_INBOUND_TRIAGEM.json`
- `WORKFLOW_02_AGENDAMENTO.json`
- `WORKFLOW_03_LEMBRETES_E_CONFIRMACAO.json`
- `WORKFLOW_04_NOSHOW_REATIVACAO.json`

3. Criar credenciais `Postgres (Skincos)` e `Google Calendar (Skincos)`.
4. Ajustar env vars no n8n.

## Teste mínimo
1) Disparar `POST` no webhook com `n8n/sample_payloads/evolution_inbound_message.json`
```bash
curl -X POST http://localhost:5678/webhook-test/wa/inbound/evolution \
  -H 'Content-Type: application/json' \
  -d @n8n/sample_payloads/evolution_inbound_message.json
```

Verifique:
- `events` com `message_received`, `lead_created`, `triage_started`.
- `messages` com inbound.

2) Verificar inserts em `events`, `processed_message_ids`, `contacts`, `conversations`, `messages`
3) Confirmar que o segundo `POST` igual não envia mensagem (idempotência)
4) Testar opt-out: mensagem "parar"
```bash
curl -X POST http://localhost:5678/webhook-test/wa/inbound/evolution \
  -H 'Content-Type: application/json' \
  -d '{
    "body": {
      "instance": "skincos",
      "data": {
        "key": { "remoteJid": "5511999999999@s.whatsapp.net", "fromMe": false, "id": "MSG-002" },
        "pushName": "Teste",
        "message": { "conversation": "parar" },
        "messageType": "conversation",
        "messageTimestamp": 1700000000
      }
    }
  }'
```

Verifique:
- `consent` com `do_not_contact=true`
- `events` com `opt_out`

### 3) Agendamento (proposta)
Continue o fluxo respondendo `Facial`, procedimento, urgência e preferências. O workflow 02 deve enviar 3 opções.

### 4) Confirmação
Responda `1` após receber opções. Deve criar evento no Google Calendar e inserir `appointments`.

### 5) Lembretes
Ajuste `start_at` para dentro de 24h e 2h e verifique `reminder_sent` + envio WhatsApp.

### 6) No-show/Reativação
Ajuste `end_at` para o passado e verifique `no_show` + `reactivation_sent`.

## Observações
- Todos os envs são configuráveis no n8n. Não hardcode segredos.
- Eventos são registrados **antes** de envio de mensagens, mudanças de status e criação de agendamento.
- Handoff humano usa `N8N_HANDOFF_NOTIFY_NUMBER` (WhatsApp interno). Ajuste conforme sua operação.
- KPIs mínimos (SQL) em `n8n/kpis.sql`.
