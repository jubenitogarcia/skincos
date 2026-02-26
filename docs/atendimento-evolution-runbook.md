# Atendimento · Evolution Runbook

## Checklist de ambiente
- `WA_ORCHESTRATOR_PROVIDER=evolution`
- `EVOLUTION_API_URL=https://wa.skincos.com.br`
- `EVOLUTION_API_KEY=<apikey>`
- `CRM_PUBLIC_URL=<https://crm.skincos.com.br ou URL do ambiente>`
- `WA_ORCHESTRATOR_WEBHOOK_TOKEN=<token>` (recomendado)
- `CRM_BASIC_AUTH=<user:pass>` (opcional)

## Fluxo de ativação do canal
1. Acesse **Atendimento → WhatsApp**.
2. Selecione o canal e clique em **Iniciar Canal**.
3. Escaneie o QR Code no WhatsApp.
4. Clique em **Sincronizar Webhook**.

## Verificações rápidas (API)
- Status do provider: `GET /api/wa-orchestrator/status`
- Webhook manual: `POST /api/wa-orchestrator/channels/:channel/webhook`
- SSE: `GET /api/wa-orchestrator/events`

## Diagnóstico de falhas
### Webhook 401
- Verifique `WA_ORCHESTRATOR_WEBHOOK_TOKEN`.
- Confirme se o Evolution recebeu o header `x-webhook-token`.

### Realtime não atualiza
- Se `CRM_BASIC_AUTH` estiver ativo, confirme autenticação básica no navegador.
- Se necessário, configure `localStorage.setItem('crm.basicAuth','<BASE64(user:pass)>')` para SSE.
- Verifique se `CRM_PUBLIC_URL` está correto.
- Inspecione `/api/wa-orchestrator/events` no DevTools → Network (SSE).

### Conversas não carregam
- Verifique `EVOLUTION_API_URL` e `EVOLUTION_API_KEY`.
- Teste `GET /api/wa-orchestrator/status`.
- Confirme se o canal está conectado.

## Observações
- Conversas/mensagens usam paginação; use **Carregar mais** quando necessário.
- O realtime depende de webhook + SSE. Se falhar, há fallback via polling.
