# Mini-PC Autonomia Multiusuário

Modelo oficial do mini-PC para `skincos`:

- código compartilhado: `C:\CodexShared\Projetos\skincos`
- worktrees compartilhados: `C:\CodexShared\Worktrees\skincos\<usuario>\<task-slug>`
- runtime oficial do orb/n8n: `C:\CodexRuntime\n8n`
- serviços WSL live: `systemd` de sistema com `User=skincos`
- estado privado do Codex por operador: `%LOCALAPPDATA%\Codex\skincos\`
- atalhos compartilhados: `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Skincos Codex`

## Bootstrap por conta Windows

No PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-shared-codex-workspace.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\validate-shared-codex-workspace.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\setup-shared-runtime.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\validate-shared-runtime.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\install-shared-codex-shortcuts.ps1
```

Dentro do WSL da conta:

```bash
cd /mnt/c/CodexShared/Projetos/skincos/modules/automations/n8n
bash scripts/bootstrap-imported-wsl-account.sh
```

Se a conta também operar Git dentro do WSL, concluir o login do GitHub CLI:

```bash
gh auth login --web --git-protocol https --hostname github.com
```

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

### Setup

- `Shared Setup`
- `Shared Validate`
- `Runtime Setup`
- `Runtime Validate`
- `WSL Account Bootstrap`

### Contexto

- `Shared Status`
- `Codex Context`
- `Thread Bootstrap`
- `New Worktree`

### Local

- `Website Local Start`
- `Website Local Stop`
- `CRM Local`
- `CRM Site EF`
- `CRM Meta Ads`
- `CRM Atendimento Clínica`
- `CRM Local Stop`

### Runtime

- `Orb Status`
- `Orb Restart`
- `Orb Repair`
- `Orb Logs`
- `Orb Validate`
- `Orb Audit`

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
  ações locais como `Codex Context` e `Website Local Start` passam a operar no
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
