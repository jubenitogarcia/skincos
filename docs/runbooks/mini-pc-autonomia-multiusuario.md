# Mini-PC com operador único e serviços isolados

Modelo oficial atual do mini-PC para `skincos`:

- código compartilhado: `C:\CodexShared\Projetos\skincos`
- worktrees compartilhados: `C:\CodexShared\Worktrees\skincos\<usuario>\<task-slug>`
- runtime oficial do orb/n8n: `C:\CodexRuntime\n8n`
- serviços WSL live: `systemd` de sistema com `User=skincos`
- keepalive Windows: `SkincosWslRuntimeKeepalive` inicia um cliente WSL
  desacoplado e o rearma a cada minuto, sem armazenar senha ou exigir UAC
- operador humano Windows e WSL: `admin`
- conta Linux de serviço, sem uso interativo: `skincos`
- estado privado do Codex: `%LOCALAPPDATA%\Codex\skincos\`
- atalhos compartilhados: `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Skincos Codex`

## Disponibilidade do WSL

- O cliente de permanência é rastreado em
  `%LOCALAPPDATA%\Codex\skincos\wsl-runtime-keepalive.pid`; ele evita que o
  WSL encerre os serviços `skincos-*` quando não há terminal humano aberto.
- `%USERPROFILE%\.wslconfig` define `vmIdleTimeout=300000` como margem de
  recuperação. O cliente desacoplado é o mecanismo principal de disponibilidade.
- Após um reboot do Windows, executar
  `powershell -ExecutionPolicy Bypass -File .\scripts\install-wsl-runtime-keepalive.ps1`
  se a tarefa não estiver ativa. O n8n pode levar até três minutos para voltar.
- `1033` no Orb significa que o Cloudflare Tunnel perdeu o conector WSL;
  `502` significa que o túnel já voltou, mas o n8n ainda está iniciando.
- O relógio do Windows deve usar `time.windows.com,0x8`. Se `w32tm /query
  /status` indicar `Local CMOS Clock` e o desvio NTP for relevante, abrir um
  PowerShell elevado, configurar o peer manual e sincronizar antes de depurar
  tarefas agendadas ou logs do WSL.

## Persistência, logs e backup do orb

- PostgreSQL salva execuções com sucesso, erro, manuais e progresso por nó.
- O histórico online é retido por 720 horas, limitado a 5.000 execuções.
- Binários usam `N8N_STORAGE_PATH` em
  `C:\CodexRuntime\n8n\n8n-home\.n8n\storage`.
- Logs JSON do n8n e logs stdout/stderr possuem rotação e retenção de 30 dias.
- `skincos-n8n-backup.timer` executa diariamente às 03:20 e mantém 30 dias de
  dumps PostgreSQL e snapshots incrementais do storage.
- `npm run service:audit-executions` verifica integridade entre banco, binários,
  configuração e backup sem imprimir payloads ou segredos. A auditoria também
  falha se a sequence de `workflow_dependency` ficar atrás do maior ID ou se um
  workflow inativo conservar `activeVersionId`, dois resíduos possíveis após
  importações PostgreSQL. Ela também reporta execuções `running` há mais de seis
  horas sem autorreparo e alerta quando a projeção de 30 dias pode alcançar o
  teto de 5.000 registros.
- O Token Vault expõe metadados e gateways operacionais ao n8n, mas nunca tokens
  descriptografados. O endpoint `/v1/tokens` permanece administrativo; Livia e
  Token Manager usam a credencial operacional criptografada do n8n.
- `npm run service:audit-execution-secrets` faz o sweep read-only e
  `npm run service:sanitize-execution-history` aplica redacções transacionais.
- `npm run service:patch-cloudinary-output` remove campos de credencial da
  resposta do community node Cloudinary antes da persistência; a convergência
  reaplica o patch e o validador detecta drift após upgrades do pacote.
- O dump PostgreSQL preserva a estrutura de uma execução, mas os blobs binários
  dependem do snapshot de `storage`. Se o prune já removeu um blob, recupere-o
  da origem autenticada e valide tamanho/MIME antes de recriar o sidecar.
- Para reparar esses invariantes após uma migração, criar primeiro um dump e
  executar `npm run service:repair-postgres-invariants`. O comando é idempotente
  e grava seu próprio checkpoint privado em `C:\CodexRuntime\n8n\exports`.
- Um cold start completo pode levar cerca de dois minutos enquanto o n8n lê os
  grafos no DrvFS e reconstrói o índice de dependências. O validador permite até
  180 segundos, mas continua exigindo saúde local e pública real. O watchdog
  usa 240 segundos de grace para não converter esse aquecimento em restart loop.
- Os backups locais não substituem uma futura cópia externa contra falha física
  do disco `C:`.

## Bootstrap do operador único

No PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-shared-codex-workspace.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\validate-shared-codex-workspace.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\setup-shared-runtime.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\validate-shared-runtime.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\install-shared-codex-shortcuts.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\install-wsl-runtime-keepalive.ps1
```

Se o token atual do Windows nao conseguir escrever em `C:\ProgramData`, o
instalador publica automaticamente os atalhos no Menu Iniciar do usuario atual
em `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Skincos Codex`.

Dentro do WSL da conta:

```bash
cd /mnt/c/CodexShared/Projetos/skincos/modules/automations/n8n
bash scripts/bootstrap-imported-wsl-account.sh
```

Para este workspace, concluir o login do GitHub CLI canônico no WSL:

```bash
gh auth login --web --git-protocol https --hostname github.com
```

Depois disso, validar com `GitHub Auth Status`.

Esse bootstrap da conta:

- registra `safe.directory` no Git local do WSL;
- prepara `C:\CodexRuntime\n8n`;
- instala ou atualiza os units `skincos-*`;
- valida se o `environment.toml` esperado do Codex App está presente;
- não promove a conta humana a dona do runtime live.

Depois do bootstrap, a conta ainda precisa abrir manualmente no Codex App o
clone compartilhado ou um worktree próprio para carregar os botões do topo do
projeto.

## Inventário dos atalhos

Atalhos de topo publicados:

- `Workspace`
- `Contexto`
- `Local`
- `EF App`
- `Orb`

Menus internos:

### Workspace

- `Shared Setup`
- `Shared Validate`
- `Runtime Setup`
- `Runtime Validate`
- `WSL Account Bootstrap`
- `GitHub Auth Login (WSL)`
- `GitHub Auth Status`

### Contexto

- `Shared Status`
- `Codex Context`
- `Codex Context Online`
- `Thread Bootstrap`
- `New Worktree`

### Local

- `Website -> Start | Stop | Site Check | Release Check`
- `CRM -> Local | Site EF | Meta Ads | Atendimento | Stop | Memory | Site Smoke | Meta Ads Smoke | Atendimento Smoke`
- `Platform Local -> Start`

### EF App

- `Setup`
- `Selftest`
- `Caixa`
- `Agenda Delta`
- `Agenda Full Sync`
- `Booking API`
- `Procedures`
- `Recorder`
- `Rotate Agenda Sync Token`

Observacao: `Client Registration` continua documentado no scraper, mas ainda
nao existe uma implementacao executavel ligada em `run_scraper.py`; o menu
mostra esse estado explicitamente.

### Orb

- `Status`
- `Restart`
- `Logs`
- `Validate`
- `Business Validate`
- `Audit`
- `Repair`
- `Support Services Apply`
- `Import Clinic Workflows Live -> Dry Run | Apply`

## Botões do projeto no Codex App

Além dos atalhos do Menu Iniciar, o repositório agora compartilha os botões do
topo do Codex App por meio de:

- `.codex/environments/environment.toml`

Regras:

- somente esse arquivo pode ser versionado dentro de `.codex`;
- o restante de `.codex` continua privado por conta;
- ao abrir `C:\CodexShared\Projetos\skincos` ou um worktree derivado no Codex
  App, a conta enxerga o mesmo conjunto de ações do projeto;
- os comandos do topo resolvem o projeto/worktree aberto dinamicamente, então
  ações locais como `Contexto` e `Local` passam a operar no
  worktree atual quando ele for o projeto aberto no app.

## Contrato de runtime

Arquivos oficiais:

- `C:\CodexRuntime\n8n\env\n8n.env`
- `C:\CodexRuntime\n8n\env\n8n-business.env`
- `C:\CodexRuntime\n8n\env\evolution-api.env`
- `C:\CodexRuntime\crm-api\env\crm-api.env`
- `C:\CodexRuntime\booking-api\env\booking-api.env`
- `C:\CodexRuntime\cloudflared\cs\config.yml`

Regras:

- `n8n.env` guarda runtime base e metadata store do n8n;
- `n8n-business.env` guarda envs funcionais de workflows, como `DATABASE_URL`,
  `GOOGLE_*` e `EVOLUTION_*`;
- `evolution-api.env` guarda a configuração própria da Evolution API;
- `crm-api.env` guarda o contrato do `skincos-crm-api.service`;
- `booking-api.env` guarda o contrato do `skincos-booking-api.service`;
- nenhum segredo operacional novo deve ficar em `%USERPROFILE%`, `/home/julia`,
  `/srv/skincos/app` ou `/etc/skincos`.

## Ambiente local vs runtime live

### Ambiente local

Usado para iterar em website, CRM e módulos locais.

- executa pelo código do workspace compartilhado ou do worktree;
- usa o estado privado do operador em `%LOCALAPPDATA%\Codex\skincos\`;
- não deve deixar PID, logs ou artefatos temporários em `C:\CodexShared`.

Para o scraper do `app.espacofacial.com.br`, o estado privado adicional fica em:

- `%LOCALAPPDATA%\Codex\skincos\espacofacial-app\report`
- `%LOCALAPPDATA%\Codex\skincos\espacofacial-app\debug`
- `%LOCALAPPDATA%\Codex\skincos\espacofacial-app\logs`
- `%LOCALAPPDATA%\Codex\skincos\espacofacial-app\chrome-profile`

O launcher `EF App Caixa` permanece interativo por desenho: ele abre o modo
`caixa` do scraper já com o estado privado configurado, mas a escolha de unidade
e período continua acontecendo no terminal do Codex App.

### Runtime live

Usado para status, logs, restart e validação do stack oficial do mini-PC.

- resolve o código em `modules\automations\n8n`;
- usa `C:\CodexRuntime\n8n` como contrato canônico;
- opera via WSL + `systemd` de sistema com os serviços `skincos-*`;
- não deve manter nenhum serviço orb ativo em `systemctl --user`;
- depende de PostgreSQL local com role/database `n8n_runtime` alinhado ao
  contrato de `C:\CodexRuntime\n8n\env\n8n.env`.
- o caminho suportado para reconciliar esse contrato, sem depender de uma conta
  “principal”, é `Orb Repair`.

## Operação do runtime

Comandos públicos equivalentes aos atalhos:

```powershell
cd C:\CodexShared\Projetos\skincos
powershell -ExecutionPolicy Bypass -File .\scripts\run-shared-codex-shortcut.ps1 -Action OrbStatus
powershell -ExecutionPolicy Bypass -File .\scripts\run-shared-codex-shortcut.ps1 -Action OrbRestart
powershell -ExecutionPolicy Bypass -File .\scripts\run-shared-codex-shortcut.ps1 -Action OrbRepair
powershell -ExecutionPolicy Bypass -File .\scripts\run-shared-codex-shortcut.ps1 -Action OrbLogs
powershell -ExecutionPolicy Bypass -File .\scripts\run-shared-codex-shortcut.ps1 -Action OrbValidate
powershell -ExecutionPolicy Bypass -File .\scripts\run-shared-codex-shortcut.ps1 -Action OrbAudit
```

Os serviços live esperados são:

- `skincos-n8n.service`
- `skincos-orb-proxy.service`
- `skincos-cloudflared-orb.service`
- `skincos-evolution.service`
- `skincos-mini-pc-watchdog.timer`
- `skincos-crm-api.service`
- `skincos-booking-api.service`
- `skincos-cloudflared-cs.service`

O comando `Orb Audit` lista todos os units `skincos-*` instalados
no mini-PC e destaca referências legadas ainda acopladas a `/srv/skincos`,
`/etc/skincos` ou `/home/julia`.

`Orb Repair` lê apenas o contrato `DB_POSTGRESDB_*` de
`C:\CodexRuntime\n8n\env\n8n.env`, reconcilia role/database/schema do
PostgreSQL local, reinicia o stack live e encerra com `Orb Validate`. A
evidência redigida fica em `C:\CodexRuntime\n8n\exports\repair-<timestamp>\`.

`Orb Validate` faz retry curto nos health checks após restart para não marcar
como falha um boot saudável que ainda está aquecendo o listener HTTP.

Para reaplicar o contrato compartilhado dos serviços de suporte:

```bash
cd /mnt/c/CodexShared/Projetos/skincos
bash ./scripts/install-shared-support-system-services.sh --apply
```

Esse instalador usa os launchers do repositório em `scripts/migration/` e os
templates em `ops/runtime/systemd/system/`.

## Importação controlada dos workflows clínicos do orb

Quando o runtime live do `n8n` ainda não tiver os workflows `WORKFLOW_01..04`,
use o helper abaixo para validar projeto, fazer backup do Postgres live e preparar o
import como `active=false`:

```bash
cd /mnt/c/CodexShared/Projetos/skincos
bash modules/automations/n8n/scripts/import-clinic-workflows-live.sh --project-id <project_id>
```

Para aplicar de fato no projeto escolhido:

```bash
cd /mnt/c/CodexShared/Projetos/skincos
bash modules/automations/n8n/scripts/import-clinic-workflows-live.sh --apply --project-id <project_id>
```

Observações:

- o script gera cópias temporárias com `active=false` para não ligar cron,
  webhook ou Google Calendar sem revisão;
- o runtime live usa o banco Postgres `n8n_runtime` definido em
  `C:\CodexRuntime\n8n\env\n8n.env`, não o SQLite legado como metadata store
  principal;
- no dry-run, ele mostra se as credenciais `Postgres (Skincos)` e
  `Google Calendar (Skincos)` ainda faltam no banco live;
- no `--apply`, ele gera backup do banco Postgres e cópias de
  `n8n.env`/`n8n-business.env` em
  `C:\CodexRuntime\n8n\exports\clinic-orb-live-<timestamp>\`;
- ele consegue preencher automaticamente apenas os valores recuperáveis do
  `n8n-business.env`; `GOOGLE_CALENDAR_ID` e `N8N_DEFAULT_TEST_PHONE` continuam
  dependentes de preenchimento manual quando estiverem ausentes;
- a credencial `Google Calendar (Skincos)` pode ser importada a partir de um
  export legado, mas ainda precisa de revisão/reauth se o OAuth disponível não
  tiver escopo de Calendar.

## Validação e handoff

Checklist de handoff entre contas:

1. Abrir o contexto no clone compartilhado.
2. Rodar `Shared Validate`.
3. Rodar `Runtime Validate`.
4. Rodar `Orb Status`.
5. Se o `n8n` falhar por desalinhamento do contrato Postgres, rodar `Orb Repair`.
6. Se houver outra intervenção no runtime, concluir com `Orb Validate`.
7. Registrar evidências em `C:\CodexRuntime\n8n\exports\<timestamp>\`.

## Critérios de limpeza do legado

Só remover o legado quando tudo abaixo for verdadeiro:

- nenhum serviço live depende de `systemctl --user`;
- `skincos-*` aponta para `C:\CodexShared\Projetos\skincos\modules\automations\n8n`;
- `skincos-crm-api.service`, `skincos-booking-api.service` e
  `skincos-cloudflared-cs.service` apontam para `C:\CodexShared\Projetos\skincos`
  e `C:\CodexRuntime\...`, não para `/srv/skincos` ou `/etc/skincos`;
- `orb.skincos.com.br/healthz` e `127.0.0.1:5678/healthz` estão saudáveis;
- `127.0.0.1:8099/health` e `127.0.0.1:8765/healthz` estão saudáveis;
- `C:\CodexRuntime\n8n` contém os envs e credenciais canônicos;
- nenhum segredo canônico restante vive em `/etc/skincos`, `/srv/skincos`,
  `%USERPROFILE%` ou `/home/julia`.

## Observação sobre o Codex App

Os atalhos compartilhados foram desenhados para operar o workspace e o runtime
sem depender de um executável interno estável do Codex App no mini-PC. O fluxo
suportado é abrir o repo ou o worktree no app manualmente e usar os atalhos para
bootstrap, contexto, ambiente local e runtime live.

Separação oficial:

- `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Skincos Codex`:
  compartilhamento operacional no Windows;
- `.codex/environments/environment.toml`: compartilhamento dos botões do topo
  por projeto/worktree no Codex App;
- login do Codex App, projetos recentes, `safe.directory`, bootstrap WSL e
  `gh auth` seguem por conta local.
- para `skincos`, o critério de pronto é o `gh` do WSL; o `gh` do Windows pode
  ficar deslogado sem quebrar os atalhos, o preflight ou os fluxos GitHub do repo.
