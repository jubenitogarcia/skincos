# Atendimento · Evolution Runbook

## Checklist de ambiente
- `WA_ORCHESTRATOR_PROVIDER=evolution`
- `EVOLUTION_API_URL=https://wa.skincos.com.br`
- `EVOLUTION_API_KEY=<apikey>`
- `CRM_PUBLIC_URL=<https://crm.skincos.com.br ou URL do ambiente>`
- `WA_ORCHESTRATOR_WEBHOOK_TOKEN=<token>` (recomendado)
- `CRM_BASIC_AUTH=<user:pass>` (opcional)
- Pages Functions:
  - `WA_ORCHESTRATOR_API_TARGET=https://api.skincos.com.br` (rota `/api/wa-orchestrator/*`)

### Harmonia (dados e ações)
- `DATABASE_URL=<postgres>` (obrigatório para inbox e conversas)
- `HARMONIA_DEBUG_TOKEN=<token>` (opcional, leitura)
- `HARMONIA_EXEC_TOKEN=<token>` (opcional, necessário para ações como “Resolver”)

## Como funciona o Atendimento (UI)
- **Coluna esquerda:** seletor de canais (WhatsApp, Instagram, Omnichannel, Help Desk, Harmonia, n8n).
- **Coluna direita:** painel ativo do canal selecionado (carrega sob demanda).

## Fluxo de ativação do canal (WhatsApp)
1. Acesse **Atendimento → Canais → WhatsApp**.
2. Selecione o canal e clique em **Iniciar Canal**.
3. Escaneie o QR Code no WhatsApp.
4. Clique em **Sincronizar Webhook**.

## Ações rápidas (Harmonia)
- **Resolver / Follow-up / Handoff / Pausar** alteram o `stage` da conversa.
- Se `HARMONIA_EXEC_TOKEN` estiver configurado, o token deve ser informado na UI para habilitar ações.

## Verificações rápidas (API)
- Status do provider: `GET /api/wa-orchestrator/status`
- Webhook manual: `POST /api/wa-orchestrator/channels/:channel/webhook`
- SSE: `GET /api/wa-orchestrator/events`
- Proxy status: `GET /api/wa-orchestrator/_proxy-status`
- Recovery local (restart + sync opcional): `POST /api/wa-orchestrator/local/recovery/restart`
- Harmonia inbox: `GET /api/harmonia/conversations?unitSlug=<slug>`
- Patch de conversa: `POST /api/harmonia/conversations/:id/patch`

Exemplo de payload para recovery com sync de código:
```json
{
  "mode": "stack",
  "syncRepo": true,
  "syncSha": "<sha>",
  "syncAutoStash": true
}
```

## Diagnóstico de falhas
### Webhook 401
- Verifique `WA_ORCHESTRATOR_WEBHOOK_TOKEN`.
- Confirme se o Evolution recebeu o header `x-webhook-token`.

### Realtime não atualiza
- Se `CRM_BASIC_AUTH` estiver ativo, confirme autenticação básica no navegador.
- Se necessário, configure `localStorage.setItem('crm.basicAuth','<BASE64(user:pass)>')` para SSE.
- Verifique se `CRM_PUBLIC_URL` está correto.
- Inspecione `/api/wa-orchestrator/events` no DevTools → Network (SSE).
- Verifique `/api/wa-orchestrator/_proxy-status` para confirmar o target correto.

### Inbox vazio
- Confirme `DATABASE_URL` e `HARMONIA_DEBUG_TOKEN`.
- Verifique `GET /api/harmonia/health`.
- Teste `GET /api/harmonia/conversations?unitSlug=<slug>`.

### Ações não funcionam
- Confirme `HARMONIA_EXEC_TOKEN` e se o token foi preenchido na UI.
- Verifique resposta do endpoint `/api/harmonia/conversations/:id/patch`.

## Observações
- Conversas/mensagens usam paginação; use **Carregar mais** quando necessário.
- O realtime depende de webhook + SSE. Se falhar, há fallback via polling.
