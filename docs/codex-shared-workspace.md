# Workspace canônico no Codex App

Este repositório pode ser usado como base compartilhada no Codex App em:

- `C:\CodexShared\Projetos\skincos`

O objetivo desta pasta é servir como clone canônico para o único operador humano
Windows/WSL, `admin`. A conta Linux `skincos` existe somente para os serviços.
Tarefas simultâneas do Codex continuam usando worktrees para evitar conflitos.

## Regras de operação

- Não guardar segredos, cookies, `.env`, `.dev.vars`, `.codex` ou perfis de
  browser dentro de `C:\CodexShared`.
- Exceção única permitida: `.codex/environments/environment.toml`, porque ele
  versiona os botões do topo do Codex App para o clone compartilhado e para os
  worktrees. Nenhum outro arquivo de `.codex` deve ser salvo aqui.
- Usar branch no formato `codex/admin/<task-slug>`.
- Se houver chance de trabalho concorrente, usar worktree dedicado em
  `C:\CodexShared\Worktrees\skincos\<ator>\<task-slug>`.
- O clone compartilhado deve ficar reservado para contexto, revisão, bootstrap
  e tarefas curtas; mudanças longas ou paralelas devem migrar para worktree.
- Autenticação, perfis de browser, envs privados, PID e temporários do Codex
  ficam fora do repositório compartilhado, em `%LOCALAPPDATA%\Codex\skincos\`.
  Logs, relatórios, checkpoints, evidências e backups locais ficam no runtime
  privado `C:\CodexRuntime\operator\admin\skincos\`.

## Fluxo de primeira execução do operador

1. Rodar o bootstrap do workspace compartilhado:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\setup-shared-codex-workspace.ps1
   ```

2. Rodar a validação do workspace:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\validate-shared-codex-workspace.ps1
   ```

3. Validar o runtime nativo do Orb:

   ```powershell
   wsl.exe -d Ubuntu-24.04 -u admin -- bash -lc "/opt/skincos/current/source/scripts/runtime/manage-native-runtime.sh validate"
   ```

4. Instalar os atalhos compartilhados:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\install-shared-codex-shortcuts.ps1
   ```

   Se a sessao atual do Windows nao tiver elevacao real para gravar em
   `C:\ProgramData`, o instalador cai automaticamente para o Menu Iniciar do
   usuario atual em `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Skincos Codex`.

5. Dentro do WSL da conta, rodar o bootstrap da conta humana:

   ```bash
   cd /mnt/c/CodexShared/Projetos/skincos/orb/engine
   bash scripts/bootstrap-imported-wsl-account.sh
   ```

6. Para este workspace, o GitHub CLI canônico é o do WSL. Autenticar por ele:

   ```bash
   gh auth login --web --git-protocol https --hostname github.com
   ```

7. Validar o estado com o atalho ou botão `GitHub Auth Status`.

8. Abrir manualmente o clone compartilhado ou o worktree no Codex App da
   própria conta para carregar os botões do topo definidos em
   `.codex/environments/environment.toml`.

## Atalhos compartilhados

Os atalhos ficam no Menu Iniciar compartilhado:

- `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Skincos Codex`

O layout principal agora foi reduzido para cinco atalhos de topo:

- `Workspace`
- `Contexto`
- `Local`
- `EF App`
- `Orb`

Todos eles abrem menus interativos por dominio.

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

O menu do scraper reserva a entrada `Client Registration`, mas o repo ainda nao
tem uma implementacao executavel ligada em `run_scraper.py`; o launcher exibe
uma mensagem clara em vez de fingir suporte.

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

`Support Services Apply` reaplica exclusivamente as units finais a partir da
release nativa. `Repair` recria o layout nativo, reaplica essas units, reinicia
e executa os smokes. Nenhuma ação inicia serviços a partir do checkout.

## Botões do topo no Codex App

O projeto agora versiona o arquivo:

- `.codex/environments/environment.toml`

Esse arquivo define os botões do topo da janela do projeto no Codex App.
Como ele é parte do repositório, o mesmo conjunto de ações aparece para qualquer
usuário local que abra:

- `C:\CodexShared\Projetos\skincos`; ou
- um worktree criado a partir desse repositório.

Limites importantes:

- o Codex App não centraliza a lista de projetos recentes entre contas;
- cada conta ainda precisa abrir manualmente o clone ou o worktree no app;
- `safe.directory`, bootstrap WSL, login do `gh` e autenticação do Codex App
  continuam por usuário;
- a fonte de verdade para GitHub neste projeto é o `gh` do WSL; o `gh` do
  Windows pode aparecer deslogado ou com `hosts.yml` vazio sem bloquear o fluxo;
- os atalhos do Menu Iniciar e os botões do topo são complementares: o primeiro
  é compartilhamento no Windows, o segundo é compartilhamento por projeto;
- a barra principal do Codex App agora foi condensada para os mesmos cinco
  atalhos de topo do Menu Iniciar.

## Local vs runtime live

Os atalhos seguem dois modelos operacionais diferentes.

### Ambiente local

Usado para edição, QA e iteração dos projetos locais como website e CRM.

- roda a partir do código em `C:\CodexShared\Projetos\skincos`;
- guarda PID e estado temporário em `%LOCALAPPDATA%\Codex\skincos\`, e logs
  persistentes em `C:\CodexRuntime\operator\admin\skincos\logs\`;
- não deve gravar artefatos operacionais novos no clone compartilhado nem no
  worktree por padrão.

Os launchers do scraper do `app.espacofacial.com.br` também seguem esse modelo:

- código em `integration/ef`;
- `report/`, `debug/` e `logs` em
  `C:\CodexRuntime\operator\admin\skincos\scraper\`; `chrome-profile` e envs
  privados em `%LOCALAPPDATA%\Codex\skincos\espacofacial-app\`;
- uso por um operador principal, sem depender de manter sessão, outputs ou
  credenciais dentro do repositório.

O botão `EF App Caixa` roda em modo interativo guiado no terminal do Codex App:

- fixa o scraper em `EF_MODE=caixa`;
- mantém os artefatos em `C:\CodexRuntime\operator\admin\skincos\scraper\`;
- ainda pergunta unidade e intervalo de datas antes da exportação.

### Runtime live

Usado para status, restart, logs e validação do runtime nativo.

- resolve código pela release imutável `/opt/skincos/current/source`;
- usa estado em `/var/lib/skincos-runtime`, configuração privada em
  `/etc/skincos` e logs em `/var/log/skincos`;
- executa via units de sistema `orb`, `orb-proxy`, `messaging-whatsapp`, `crm`,
  `booking`, `cloudflare-orb` e `cloudflare-runtime`;
- não depende de `systemctl --user`, checkout, worktree ou DrvFS;
- usa PostgreSQL local para o Orb e publica somente backups restore-verified em
  `C:\CodexRuntime\backups\orb\daily`.

Quando o contrato estiver desalinhado, `Orb Repair` recria o layout nativo,
reaplica as units finais, reinicia e executa os smokes suportados.

## Status rápido e worktrees

Para ver em um único comando se o clone compartilhado está sujo, qual branch
está ativa e quais worktrees já existem:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\show-shared-codex-status.ps1
```

Para iniciar uma tarefa nova sem trabalhar direto no clone compartilhado:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\new-shared-worktree.ps1 -TaskSlug corrigir-site-ef -Fetch
```

Exemplo de saída esperada:

- branch `codex/<usuario>/corrigir-site-ef`
- worktree `C:\CodexShared\Worktrees\skincos\<usuario>\corrigir-site-ef`

## Fluxo recomendado para múltiplos usuários no Codex

1. Rodar bootstrap, validação e instalação dos atalhos uma vez por usuário.
2. Abrir `C:\CodexShared\Projetos\skincos` no Codex App para entender o contexto.
3. Usar `Codex Context` ou rodar `bash ./scripts/codex-context.sh` via WSL.
4. Para qualquer tarefa paralela ou mais longa, criar um worktree por usuário/tarefa.
5. Abrir o worktree no Codex App e trabalhar só nele.
6. Rodar apps locais com perfil, autenticação, temporários e overrides em
   `%LOCALAPPDATA%\Codex\skincos\`; os artefatos duráveis vão para o runtime
   privado em `C:\CodexRuntime\operator\admin\skincos\`.
7. Antes de handoff, atualizar `CODEX_CONTEXT.md`, `TASKS.md` e `DECISIONS.md`.
8. Após PR integrado e worktree limpo, remover o worktree com
   `git -C C:\CodexShared\Projetos\skincos worktree remove <caminho>` e
   `git -C C:\CodexShared\Projetos\skincos worktree prune`. Nunca remover
   worktrees sujos, sem integração confirmada ou gerenciados pelo Codex App.

## Auditoria contínua de footprint

Rode periodicamente, ou antes de uma limpeza, a auditoria somente-leitura:

```powershell
npm run codex:footprint:audit
```

Ela confere worktrees limpos/mesclados, caminhos aposentados, tarefas
agendadas, backup Orb, espaço em disco, `git fsck` e health local/público
de Orb e CRM. Use `npm run codex:footprint:validate` em uma sessão elevada
somente quando todos os legados reportados tiverem sido removidos.

Quando o worktree é aberto no Codex App, os botões do topo passam a chamar os
scripts relativos daquele próprio worktree, sem cair de volta no clone
compartilhado por hardcode de path.

## Sobre a integração com o Codex App

Os atalhos desta pasta são operacionais: eles chamam scripts PowerShell e WSL do
próprio workspace. Eles não dependem de um executável interno estável do Codex
App instalado no mini-PC, porque não foi encontrada uma instalação local
canônica do aplicativo para usar como alvo suportado.

`Orb Validate` faz retry curto nos health checks do orb para evitar falso
negativo logo após um restart saudável do stack.

`Orb Repair` não move dados nem recria segredos: ele garante o layout nativo,
reaplica as units da release promovida, reinicia e roda health/smoke.

Critério oficial de pronto:

- `GitHub Auth Status` deve mostrar `WSL gh auth: ready`;
- `npm run codex:preflight` deve passar em WSL;
- o `gh` do Windows é opcional e não é mais critério de aceite para o fluxo do
  `skincos`.
