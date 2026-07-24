# Monitoramento externo do SKINCOS

## Fonte de verdade e limite atual

O catálogo em `ops/observability/catalog.json` define os probes. O monitor primário é executado fora do GitHub Actions e dos Workers da Cloudflare, no runtime Windows do operador. Ele registra `latest.json`, `history.jsonl`, `metrics.prom`, `dashboard.html` e `notifications.jsonl` em `C:\CodexRuntime\operator\admin\skincos\observability`.

O estado `healthy` mede somente o endpoint de health e o orçamento de latência. `contract_status: incomplete` ou `partial` significa que a unidade ainda não comprovou todos os campos/health-readiness-dependencies-version exigidos: não é gate de promoção.

## Instalação e rollback

Executar em PowerShell elevado, após validar a branch/PR:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\observability\scripts\Install-SkincosObservability.ps1
Get-ScheduledTaskInfo -TaskName SkincosObservabilityProbe
```

Rollback estrito:

```powershell
Unregister-ScheduledTask -TaskName SkincosObservabilityProbe -Confirm:$false
```

O rollback remove apenas a tarefa; os arquivos de evidência ficam retidos no runtime privado.

## Alerta e recuperação controlados

1. Execute uma baseline sem `-ControlledFailure`.
2. Execute `Invoke-SkincosObservability.ps1 -ControlledFailure`.
3. Confirme em `notifications.jsonl` uma transição `alert` de `controlled-alert-drill`, com os módulos saudáveis listados.
4. Execute novamente sem a flag e confirme uma transição `resolved`.

O drill não acessa nem altera nenhum serviço de produção. Caso o Event Log não esteja disponível, o monitor grava `notification_delivery: durable-evidence-fallback`; isto é evidência operacional, não confirmação de notificação humana.

## Rota de notificação

O destino mínimo é Windows Application Event Log, source `SkincosObservability`, com IDs 1001/1002. A tarefa e a fonte exigem privilégio administrativo neste host. Um webhook HTTPS opcional usa apenas `SKINCOS_OBS_NOTIFICATION_WEBHOOK` e `SKINCOS_OBS_NOTIFICATION_TOKEN` no ambiente privado da tarefa; nunca colocar URL/token no repositório. A configuração do webhook só é considerada pronta depois de um alerta e uma recuperação entregues ao destino humano aprovado.

## Jornada autenticada

Criar um ator de staging exclusivo, sem dados pessoais, depois do deploy canônico de Identity e Finance. Guardar a senha/token apenas como secret do ambiente de staging e validar uma leitura sem escrita. Não usar sessão de colaborador nem credencial de produção.
