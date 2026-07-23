# Meta Ads Publish - Production Hardening

## Resultado da auditoria

O workflow live `eFJhFg79lyaycjlm` executava chamadas Meta diretamente, carregava o
bearer nos itens e usava retries genéricos em POSTs. A execução histórica `25`
comprovou falha parcial: cinco creatives e cinco updates ocorreram antes da falha
do sexto creative.

A topologia endurecida remove tokens dos itens do n8n e usa o Token Vault como
gateway allowlisted. O workflow permanece manual e inativo até uma execução real
controlada ser autorizada.

## Fluxo operacional

1. O Drive lista todos os arquivos ainda não publicados com metadados completos.
2. O gateway entrega somente configuração e `token_id` opaco.
3. O inventário Meta é buscado uma vez por conta, com paginação limitada.
4. O workflow bloqueia o lote se houver vídeo, grupo incompleto ou slot duplicado.
5. Um run durável adquire locks de batch e arquivos.
6. IA e uploads são processados; o contrato exige 5 bodies, 5 titles e 1 description.
7. Todos os creatives flexíveis são criados e verificados antes dos anúncios.
8. `stage_batch` prepara anúncios em `PAUSED`; `activate_batch` ativa somente após o lote completo.
9. Falhas acionam compensação: anúncios existentes são restaurados e novos ficam pausados.
10. O Drive é atualizado e relido; somente depois o run vira `completed`.
11. WhatsApp e Telegram são independentes e protegidos por evento idempotente.

## Idempotência e recuperação

- O batch é identificado por configuração + IDs/checksums/datas dos arquivos.
- Operações possuem chave única e hash calculado no gateway.
- Repetição idêntica retorna o resultado persistido; payload divergente gera conflito.
- Locks de batch, arquivo e anúncio têm TTL de 30 minutos e heartbeat.
- Timeout após POST exige readback; a chamada não é repetida cegamente.
- `meta_completed_drive_pending` retoma somente a finalização do Drive.
- `reconciliation_required` exige intervenção antes de uma nova publicação.

## Segurança

- O export não contém bearer, Graph URL direto nem `$vars.TOKEN_VAULT_API_TOKEN`.
- A autenticação n8n usa uma credencial criptografada `httpBearerAuth` dedicada.
- O gateway valida conta, token, versão, IDs, host, ação e tamanho do payload.
- Auditoria registra códigos Meta, `fbtrace_id`, tentativas e rate usage, sem token.
- Execuções manuais e sucessos não são persistidos pelo workflow; o journal D1 é a fonte operacional.

## Validação e rollout

Execute antes de sincronizar:

```bash
node --test backend/apps/token-vault/tests/*.test.js \
  modules/automations/n8n/tests/meta-ads-publish.test.js
node modules/automations/n8n/scripts/sync-meta-ads-publish-sources.js check
node modules/automations/n8n/scripts/build-meta-ads-publish-production-workflow.js
```

Valide o gateway e o estado persistido sem expor o bearer:

```bash
sudo -u postgres node modules/automations/n8n/scripts/validate-meta-ads-publish-gateway-live.js
sudo -u postgres node modules/automations/n8n/scripts/validate-meta-ads-publish-live-state.js
```

Estado implantado em 2026-07-10:

- Token Vault Worker version `11`, deployment `a270dddb-8999-4f9c-ace6-3cb02ab1a190`.
- Workflow principal version counter `569`, inativo, após normalização de startup do n8n.
- Error workflow `metaAdsPublishErrorV1`, inativo e associado ao principal.
- Credencial `metaPublishGatewayBearer` criptografada e compartilhada com o projeto.
- Journal D1 criado e vazio; nenhuma operação Meta foi executada no rollout.

O sincronizador live é dry-run por padrão. `--apply` grava credencial, error workflow
e workflow principal em uma transação PostgreSQL, sempre com checkpoint em
`C:\CodexRuntime\n8n\exports\workflow-patches`.

Nenhum teste automatizado publica anúncios reais. A classificação final permanece
`apto para execução controlada`, não `GO` irrestrito, até uma rodada autorizada de
1 grupo e 2 unidades confirmar Meta, Drive, journal e notificações.
