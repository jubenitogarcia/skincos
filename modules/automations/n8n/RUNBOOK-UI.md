# Runbook - UI do n8n (local)

Antes de usar os comandos abaixo, exporte `N8N_ROOT` para o clone/runtime ativo.
No modelo atual, o codigo live fica em
`C:\CodexShared\Projetos\skincos\modules\automations\n8n` e
o estado da maquina fica em `C:\CodexRuntime\n8n` montado no WSL como
`/mnt/c/CodexRuntime/n8n`. Nunca coloque `.env`, `database.sqlite` ou arquivos
do tunnel dentro de `C:\CodexShared`.

## Caminho suportado hoje
```bash
npm run service:status
npm run service:restart
npm run service:validate
npm run service:validate:business
```

Os comandos abaixo que falam em cutover, `systemctl --user` ou `start-n8n.sh`
devem ser tratados como ferramental historico/local, nao como operacao live do
orb.

## Fase 2 - runtime compartilhado em WSL
```bash
scripts/preflight-wsl-shared-runtime.sh
scripts/cutover-wsl-shared-runtime.sh --apply
scripts/cutover-wsl-shared-runtime.sh --apply --start-services
```
O cutover copia `.env` e estado do runtime para `C:\CodexRuntime\n8n`,
reinstala os units apontando para o clone compartilhado e remove a dependencia
operacional do runtime antigo.

## Start/Stop
```bash
$N8N_ROOT/start-n8n.sh start
$N8N_ROOT/start-n8n.sh stop
$N8N_ROOT/start-n8n.sh restart
```

Esse launcher agora deve ser entendido como local/manual e grava estado privado
do operador fora do checkout compartilhado.

## Backup
```bash
$N8N_ROOT/scripts/backup-n8n.sh
```
Obs: o backup automático diário via `launchd` foi desativado. Use apenas manualmente quando necessário.

## Restore (manual)
1. Pare o n8n.
2. Substitua os arquivos:
   - `/mnt/c/CodexRuntime/n8n/n8n-home/database.sqlite`
   - `/mnt/c/CodexRuntime/n8n/n8n-home/config`
   - `/mnt/c/CodexRuntime/n8n/binary-data/`
3. Inicie o n8n.

## Rotacao de logs
```bash
$N8N_ROOT/scripts/rotate-n8n-logs.sh
```

## Limpeza operacional sensível
```bash
$N8N_ROOT/scripts/clean-sensitive-runtime.sh
```
Use após debug, exports manuais ou incidentes que tenham gerado dumps em `tmp/`.

## Meta Ads - fonte de autenticação
- `Meta Ads – Performance Report (2)` (`xN8juRoQBMa4JKOd`): a configuração operacional vem da planilha `DESTINOS`.
- Token aceito em `DESTINOS`: `meta_ads_access_token`, `facebook_ads_access_token`, `fb_ads_access_token`, `access_token` ou `ad_account_access_token`.
- Roteamento aceito em `DESTINOS`: `instance_name` ou `evolution_instance_name`, e `remote_jid` ou `whatsapp_jid` ou um telefone convertível em JID.
- Destino Meta mínimo em `DESTINOS`: `account_id`, `adset_id`, `page_id`, `instagram_user_id`, `destination_name`.
- O workflow falha cedo se `DESTINOS` não resolver exatamente uma linha utilizável.
- `Meta Ads - Duplicate Ads to Another Adset`: o token deve entrar em `Meta API Params` usando os mesmos nomes aceitos acima.
- Os workflows Meta não carregam mais `Authorization` hardcoded no JSON exportado.

## Meta Ads - entrega do relatório
- `Meta Ads – Performance Report (2)` envia `1` mensagem de texto por grupo e `N` mídias por grupo.
- A entrega não usa mais `splitInBatches`; ela usa fila explícita com validação final de contagem.
- O workflow falha com `delivery_blocked` se houver mídia inválida ou com `delivery_incomplete` se a contagem enviada divergir do esperado.
- Se a coleta vier degradada, a execução pode concluir com status de negócio `partial`.

## orb-proxy
- `INTEGRATIONS_ENCRYPTION_SECRET` é obrigatório. Sem isso, o `orb-proxy` não inicia.
- Ao subir com a secret configurada, o `orb-proxy` regrava tokens legados do store local em formato cifrado.

## LaunchAgents
- n8n: `$HOME/Library/LaunchAgents/com.jubenito.n8n-evolution.plist`
- logrotate: `$HOME/Library/LaunchAgents/com.jubenito.n8n-logrotate.plist`
