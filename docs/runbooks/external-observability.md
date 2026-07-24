# Monitoramento externo do SKINCOS

## Fonte de verdade e limite atual

O catálogo em `ops/observability/catalog.json` define os probes. O monitor primário é executado fora do GitHub Actions e dos Workers da Cloudflare, no runtime Windows do operador. Ele registra `latest.json`, `history.jsonl`, `metrics.prom`, `dashboard.html` e `notifications.jsonl` em `C:\CodexRuntime\operator\admin\skincos\observability`.

O estado `healthy` mede somente o endpoint de health e o orçamento de latência. `contract_status: incomplete` ou `partial` significa que a unidade ainda não comprovou todos os campos/health-readiness-dependencies-version exigidos: não é gate de promoção.

O instalador registra três tarefas Windows: probe a cada minuto, dashboard local em loopback e watchdog independente a cada dois minutos. Em sessão elevada, elas executam como `SYSTEM` e iniciam no boot; sem elevação, executam como o operador atual, iniciam no logon e continuam automaticamente durante sua sessão. Caso uma política local bloqueie até a criação de tarefas do operador, o instalador registra um supervisor em `HKCU\...\Run`: ele inicia no próximo logon, executa probes a cada minuto e reinicia o dashboard se ele encerrar. O modo efetivo fica em `installation.json`. O dashboard fica somente em `127.0.0.1`, expõe `/`, `/health` e `/metrics` e não depende de Cloudflare ou GitHub. `history.jsonl`, `metrics-history.jsonl` e `notifications.jsonl` retêm 30 dias; nenhum token, payload de negócio ou dado pessoal é gravado.

## Instalação e rollback

Executar em PowerShell elevado, após validar a branch/PR. Se a política local impedir o Agendador de Tarefas, o instalador usa automaticamente o supervisor do perfil do operador; confirme o modo antes de testar:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\observability\scripts\Install-SkincosObservability.ps1
Get-ScheduledTaskInfo -TaskName SkincosObservabilityProbe
Get-ScheduledTaskInfo -TaskName SkincosObservabilityDashboard
Get-ScheduledTaskInfo -TaskName SkincosObservabilityWatchdog
Invoke-RestMethod (Get-Content C:\CodexRuntime\operator\admin\skincos\observability\dashboard-url.txt).Trim() + 'health'
Get-Content C:\CodexRuntime\operator\admin\skincos\observability\installation.json
```

Rollback estrito:

```powershell
Unregister-ScheduledTask -TaskName SkincosObservabilityProbe -Confirm:$false
Unregister-ScheduledTask -TaskName SkincosObservabilityDashboard -Confirm:$false
Unregister-ScheduledTask -TaskName SkincosObservabilityWatchdog -Confirm:$false
Remove-ItemProperty -Path HKCU:\Software\Microsoft\Windows\CurrentVersion\Run -Name SkincosObservability -ErrorAction SilentlyContinue
```

O rollback remove apenas o agendamento e a inicialização automática; se o modo `operator-run-key` estiver ativo, encerre o processo supervisor na próxima sessão ou reinicie o Windows. Os arquivos de evidência ficam retidos no runtime privado.

## Alerta e recuperação controlados

1. Execute uma baseline sem `-ControlledFailure`.
2. Execute `Invoke-SkincosObservability.ps1 -ControlledFailure`.
3. Confirme em `notifications.jsonl` uma transição `alert` de `controlled-alert-drill`, com os módulos saudáveis listados.
4. Execute novamente sem a flag e confirme uma transição `resolved`.

O drill não acessa nem altera nenhum serviço de produção. Caso o Event Log não esteja disponível, o monitor grava `notification_delivery: durable-evidence-fallback`; isto é evidência operacional, não confirmação de notificação humana.

## Rota de notificação

O destino humano primário é a mensagem Windows entregue às sessões locais ativas, além do Windows Application Event Log, source `SkincosObservability`, com IDs 1001/1002/1003. O monitor registra `windows-message-delivered` somente quando o sistema aceita a entrega; esse recibo, alerta e resolução permanecem em `notifications.jsonl` privado. Um webhook HTTPS opcional usa apenas `SKINCOS_OBS_NOTIFICATION_WEBHOOK` e `SKINCOS_OBS_NOTIFICATION_TOKEN` no ambiente privado da tarefa; nunca colocar URL/token no repositório.

## Jornada autenticada

Criar um ator de staging exclusivo, sem dados pessoais, depois do deploy canônico de Identity e Finance. Guardar a senha/token apenas como secret do ambiente de staging e validar uma leitura sem escrita. Não usar sessão de colaborador nem credencial de produção.
