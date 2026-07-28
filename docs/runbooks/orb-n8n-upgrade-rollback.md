# Runbook de rollback Orb/n8n

Rollback somente após gatilho objetivo e backup restore-verified. Não existe
`db:revert` neste procedimento: downgrade de schema sem restaurar o backup é
proibido.

## Gatilhos objetivos

Acionar se ocorrer qualquer um: migration abortada/deadlock; `/healthz` sem 200;
consentimento duplicado para `(userId,clientId)`; token/revoke inconsistente;
MCP expõe `execute_workflow` ou ferramenta mutável; sanitização falha; rota MCP
pública diferente de 404; listener fora de loopback; Orb/CRM/Booking/WhatsApp
falha; serviço exigido inativo; segredo em log; perda de dados; ou baseline de
CPU/memória/disco/fila excedida pelos alertas já existentes.

## Sequência aprovada

1. Registrar timestamp, SHA ativo, migration observada, health e PID; preservar
   logs sanitizados e não interromper o serviço de backup.
2. Desativar triggers parando somente o Orb afetado:
   `sudo systemctl stop orb.service orb-proxy.service`.
3. Confirmar que não há processo n8n residual e que CRM/Booking/WhatsApp não
   foram parados sem decisão específica.
4. Repor o install root imutável comprovado de n8n 2.8.3 (`N8N_PREVIOUS_INSTALL_ROOT`)
   e o unit/config checkpoint. Não iniciar de worktree, DrvFS ou `/var/lib`.
5. Restaurar o banco **somente** a partir de `N8N_BACKUP_DIR` previamente
   verificado por `verify-backup.sh`, usando o dump e o procedimento canônico de
   restore do projeto. Não usar `db:revert`, não apagar `oauth_user_consents` e
   não improvisar `DROP/ALTER`.
6. Restaurar configurações/volumes privados somente após validar hashes e ACLs.
7. Iniciar n8n 2.8.3 e proxy; validar migrations esperadas da versão anterior,
   `/healthz` 200 e ausência de locks.
8. Confirmar 43 workflows preservados, estados active/inactive coerentes,
   zero alteração de credenciais e contagem de execuções sem duplicação.
9. Validar gateway MCP: loopback-only, 9 tools readonly, ausência de
   `execute_workflow`, sanitização, rate-limit/timeout e rotas públicas 404.
10. Validar `orb`, `orb-proxy`, `messaging-whatsapp`, `crm`, `booking`,
    `cloudflare-orb` e `cloudflare-runtime` conforme o catálogo; não reiniciar
    unidades não afetadas sem autorização.
11. Reexecutar smokes de Orb/CRM/Booking/WhatsApp e regressão OAuth sintética em
    staging/fixture. Não executar workflow real para “confirmar” o rollback.
12. Se todos os gates estiverem verdes, manter 2.8.3 e registrar `ROLLBACK_APLICADO`;
    caso contrário, classificar `ROLLBACK_NAO_COMPROVADO` e parar para decisão.

## Evidências obrigatórias

Checkpoint, backup manifest/hash (sem valores), release/binário 2.8.3, migrations,
43 workflows, credenciais por contagem/tipo sem dados, status dos serviços, MCP
sanitizado, HTTP 404, timestamps de parada/startup, RTO/RPO observado e decisão
humana. O backup/dump nunca entra no PR.
