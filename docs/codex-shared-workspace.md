# Workspace canônico no Codex App

O clone compartilhado do monorepo fica em:

`C:\CodexShared\Projetos\skincos`

Ele serve para contexto, revisão e bootstrap. Tarefas não triviais usam
worktrees em `C:\CodexShared\Worktrees\skincos\<ator>\<tarefa>`; o clone
compartilhado não é superfície normal de edição.

## Regras

- Não guardar segredos, cookies, `.env`, perfis de browser ou dados reais no
  repositório.
- Usar branches `codex/admin/<tarefa>` e registrar a proveniência do worktree.
- Guardar estado local em `%LOCALAPPDATA%\Codex\skincos\` e logs/recibos em
  `C:\CodexRuntime\operator\admin\skincos\`.
- O projeto CRM independente é operado somente em
  `C:\CodexShared\Projetos\crm`; este workspace não materializa seu código.

## Primeira execução

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-shared-codex-workspace.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\validate-shared-codex-workspace.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\install-shared-codex-shortcuts.ps1
```

Autenticação do GitHub CLI, quando necessária, deve passar pelo gateway WSL:

```powershell
.\scripts\invoke-skincos-wsl.ps1 -Executable gh -ArgumentList auth,login,--web,--git-protocol,https,--hostname,github.com -SkipBootstrapCheck -SkipNodeCheck -SkipNpmCheck -SkipGitCheck
```

## Ações do Codex App

`.codex/environments/environment.toml` oferece Workspace, Contexto, Codex
Autônomo, EF App, Orb e a prévia local da Beauty Movement. Os atalhos executam
somente scripts relativos ao projeto aberto; não há ação de runtime para outro
produto.

Orb/n8n tem projeto e repositório próprios. Abrir
`C:\CodexShared\Projetos\orb` para operar workflows, exportações ou dados do
Orb.

## Runtime e validação

Node, Python, Playwright, Wrangler e testes rodam no Ubuntu-24.04 por meio de
`scripts/invoke-skincos-wsl.ps1`. Nunca reutilize `node_modules` do Windows no
WSL. Antes do handoff, rode a validação focal e `git diff --check`.

Para auditar worktrees e footprint:

```powershell
npm run codex:footprint:audit
```

Não remova worktrees sujos ou gerenciados pelo Codex App. Arquive clones
antigos somente depois de confirmar branch, commit, status e recuperação.
