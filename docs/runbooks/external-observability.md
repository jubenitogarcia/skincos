# Monitoramento externo do SKINCOS

## Fonte de verdade e limite atual

O catálogo em `ops/observability/catalog.json` define os probes. O monitor primário é executado fora do GitHub Actions e dos Workers da Cloudflare, no runtime Windows do operador. Ele registra `latest.json`, `history.jsonl`, `metrics.prom`, `dashboard.html` e `notifications.jsonl` em `C:\CodexRuntime\operator\admin\skincos\observability`.

O estado `healthy` mede somente o endpoint de health e o orçamento de latência. `contract_status: incomplete` ou `partial` significa que a unidade ainda não comprovou todos os campos/health-readiness-dependencies-version exigidos: não é gate de promoção. O alerta humano só é confirmado após duas leituras não saudáveis consecutivas; a recuperação também exige duas leituras saudáveis e fica registrada, sem abrir pop-up.

O instalador registra três tarefas Windows: probe a cada minuto, dashboard local em loopback e watchdog independente a cada dois minutos. Em sessão elevada, elas executam como `SYSTEM` e iniciam no boot; sem elevação, executam como o operador atual, iniciam no logon e continuam automaticamente durante sua sessão. Caso uma política local bloqueie até a criação de tarefas do operador, o instalador registra um supervisor em `HKCU\...\Run`: ele inicia no próximo logon, executa probes a cada minuto e reinicia o dashboard se ele encerrar. Nesse modo é esperado que as três tarefas estejam ausentes; a prova é `installation.json` com `execution_mode=operator-run-key`, a chave Run, exatamente um supervisor e seu único dashboard filho. O instalador exclui o próprio PID ao encerrar processos anteriores. O dashboard fica somente em `127.0.0.1`, expõe `/`, `/health` e `/metrics` e não depende de Cloudflare ou GitHub. `history.jsonl`, `metrics-history.jsonl` e `notifications.jsonl` retêm 30 dias; nenhum token, payload de negócio ou dado pessoal é gravado.

## Instalação e rollback

Executar em PowerShell elevado, após validar a branch/PR. O instalador encerra somente o supervisor desse runtime antes de iniciar o modo selecionado, evitando dois loops de probe concorrentes. Se a política local impedir o Agendador de Tarefas, ele usa automaticamente o supervisor do perfil do operador; confirme o modo antes de testar:

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

Se a fonte `SkincosObservability` ainda não existir no Windows Application Event
Log, as tentativas ficam registradas como `event_log_delivery=failed`, mas a
política de confirmação, o popup com expiração e `notifications.jsonl` continuam
operacionais. Execute uma reinstalação elevada para registrar a fonte; não
interprete essa limitação de telemetria como confirmação de entrega humana.

## Alerta e recuperação controlados

1. Execute uma baseline sem `-ControlledFailure`.
2. Execute `Invoke-SkincosObservability.ps1 -ControlledFailure`.
3. Execute novamente com a flag; confirme em `notifications.jsonl` uma transição `alert` de `controlled-alert-drill`, com os módulos saudáveis listados e `confirmed_after_runs: 2`.
4. Execute duas vezes sem a flag e confirme uma transição `resolved` com `human_notification_delivery: not-applicable`.

O drill não acessa nem altera nenhum serviço de produção. Caso o Event Log não esteja disponível, o monitor grava `notification_delivery: durable-evidence-fallback`; isto é evidência operacional, não confirmação de notificação humana.

## Rota de notificação

O destino humano primário é uma mensagem Windows apenas para alertas confirmados, além do Windows Application Event Log, source `SkincosObservability`, com IDs 1001/1002/1003. O monitor aplica cooldown de 15 minutos por unidade e a janela expira após 30 segundos; resoluções permanecem no Event Log, webhook e `notifications.jsonl`, sem mensagem de desktop. Um webhook HTTPS opcional usa apenas `SKINCOS_OBS_NOTIFICATION_WEBHOOK` e `SKINCOS_OBS_NOTIFICATION_TOKEN` no ambiente privado da tarefa; nunca colocar URL/token no repositório.

## Jornada autenticada

Criar um ator de staging exclusivo, sem dados pessoais, depois do deploy canônico de Identity e Finance. Guardar a senha/token apenas como secret do ambiente de staging e validar uma leitura sem escrita. Não usar sessão de colaborador nem credencial de produção.
