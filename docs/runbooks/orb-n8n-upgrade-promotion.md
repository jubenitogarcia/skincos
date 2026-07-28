# Runbook de promoção controlada Orb/n8n 2.8.3 → 2.32.5

Status deste documento: **proposta revisável; não executado**. A qualificação de
staging está em andamento, portanto este runbook ainda não autoriza
promoção. Toda execução futura exige janela aprovada, operador identificado e
`N8N_UPGRADE_ENV` confirmado.

Manifesto fixo: `ops/runtime/n8n-upgrade/VERSION_MANIFEST.json`. Artifact: n8n
2.32.5, tarball e integridade npm fixados no manifesto. A primeira versão com a
correção OAuth observada foi 2.19.0; o alvo deste pacote é 2.32.5. Nenhum token,
senha ou dump pertence a este repositório.

## Gates operacionais

| # | Comando canônico (futuro) | Resultado esperado | Aprovação | Rollback | Evidência |
|---:|---|---|---|---|---|
| 1 | `N8N_UPGRADE_ENV=production N8N_EXPECTED_ENV=production ops/runtime/n8n-upgrade/preflight.sh --dry-run` | ambiente, SHA, Node/PostgreSQL e manifesto conferem | identidade/ambiente/SHA exatos | parar o change set | saída sanitizada + SHA |
| 2 | confirmação registrada da janela e `N8N_APPROVAL_ID` | janela e owner confirmados | aprovação humana atual | cancelar antes de tocar runtime | ID da aprovação |
| 3 | `.../status.sh` | Orb/n8n, proxy, quatro serviços, sockets e health iniciais verdes | baseline dentro dos limites existentes | não prosseguir | status/health |
| 4 | `.../checkpoint.sh` | release pointer, units e metadados preservados | checkpoint legível | restaurar checkpoint | diretório privado + hashes |
| 5 | `.../backup.sh` | tarefa `SkincosOrbBackup` concluída | `LastTaskResult=0` | não parar Orb | tarefa e timestamp |
| 6 | `N8N_BACKUP_DIR=<privado> .../verify-backup.sh` | `RestoreVerified=True`, hashes DB/storage presentes | restore verificado | cancelar | manifest e hashes, sem valores sensíveis |
| 7 | backup de `/etc/skincos`, volumes e units pelo runbook lifecycle | cópias privadas e ACLs corretas | restauração verificável | cancelar | inventário/hash |
| 8 | confirmar drain/parada de triggers: `sudo systemctl stop orb.service` após registrar estado | nenhum novo trigger/workflow inicia | owner confirma janela sem execução | `rollback.sh` | timestamp, status e contagem |
| 9 | `sudo systemctl stop orb-proxy.service orb.service` | parada ordenada, sem processos órfãos | somente serviços Orb afetados | repor serviços anteriores | journal/status |
| 10 | `N8N_ARTIFACT_PATH=<tarball privado> .../upgrade.sh` | tarball íntegro em `/opt/skincos/releases/<SHA>/n8n` imutável | SHA/integridade conferidos | manter `/usr/local/bin/n8n` 2.8.3 intacto | `sha256sum`, npm log sanitizado |
| 11 | `.../configure-community-packages.sh` | inventário dos 10 packages com SHA-512 em EnvironmentFile restrito | colisão Evolution original recusada | restaurar checkpoint de config | hash/contagem, sem segredo |
| 12 | `.../activate-versioned-runtime.sh` | drop-in aponta apenas o Orb ao binário 2.32.5 versionado | `N8N_APPROVED_SHA` exato | restaurar drop-in 2.8.3 do checkpoint | `systemd-analyze verify` |
| 13 | `N8N_BIN=<binário 2.32.5> .../migrate.sh` | migrations 143→227 sem erro/lock | backup verificado + aprovação | restaurar DB, nunca `db:revert` | contagem/migration log |
| 14 | `systemctl daemon-reload` e promoção canônica de source, seguida por `orb-safe-restart.sh` | startup limpo, loopback, health 200 | health/local listener | fence + restore de source/config/DB | journal + health |
| 13 | `.../smoke.sh` | Orb, CRM, Booking, WhatsApp, quatro serviços e MCP público 404 | todos os gates verdes | rollback imediato | JSON/TSV sanitizado |
| 14 | `N8N_UPGRADE_ENV=staging .../validate-oauth.sh` em fixture sintética equivalente | consentimento repetido deixa uma linha; tokens/revoke/restart | somente fixture sem PII | rollback staging | contagens sem valores |
| 15 | `N8N_MCP_BEARER_FILE=<privado> .../validate-mcp.sh` | auth, 9 tools readonly, sem `execute_workflow`, sanitização, limites | gateway loopback | bloquear/rollback | resposta sanitizada |
| 16 | smoke sintético aprovado para Orb/CRM/Booking/WhatsApp | jornadas e negativas esperadas | owners de cada domínio | rollback | IDs de fixture, sem payloads |
| 17 | `.../status.sh` | exatamente `orb.service`, `orb-proxy.service`, `cloudflare-orb.service` e `skincos-orb-mcp-readonly.service` ativos/habilitados | operador confirma exatamente os quatro | rollback | status |
| 18 | `curl -i https://orb.skincos.com.br/mcp-server` e `/mcp-server/http` | ambos 404 | segurança/perímetro | rollback e bloqueio | códigos HTTP |
| 19 | `.../status.sh` + observação inicial | errors OAuth/MCP/workflows/CPU/memória/disco dentro do baseline existente | owner aceita baseline | rollback em qualquer gate | janela de observação |
| 20 | decisão formal manter/reverter | todos os gates verdes, sem drift | aprovação humana final | `rollback.sh` | decisão + checkpoint |
| 21 | reativação controlada: `sudo systemctl start orb.service orb-proxy.service` e validação | triggers retomados somente após decisão | owner confirma | parar e rollback | timestamp/status |

## Regras de parada

- Não executar workflow manualmente, não alterar credenciais e não repetir
  consentimento OAuth real.
- Não usar tags flutuantes, `npm install n8n@latest`, cópia manual para `/var/lib`
  ou execução a partir de checkout/worktree.
- Qualquer erro de migration, lock, OAuth duplicado, ferramenta mutável, segredo
  em log, rota pública diferente de 404, serviço ausente ou perda de health
  interrompe a janela e inicia o rollback.
- Os limites de CPU, memória, disco, filas e erros devem vir do baseline/alertas
  já existentes; este pacote não inventa thresholds.

## Comandos proibidos nesta etapa

Nenhum script `upgrade.sh`, `migrate.sh`, `checkpoint.sh` em modo apply, parada,
startup, `wsl --shutdown`, Cloudflare/DNS/Tunnel ou migration de produção foi
executado durante a preparação deste pacote.
