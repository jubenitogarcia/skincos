# Um projeto Git, ambientes locais por computador

O código e os lockfiles do SKINCOS já são compartilhados em
`https://github.com/jubenitogarcia/skincos`. Cada computador mantém seu clone e
seu ambiente; Git transporta commits, não dependências, credenciais, perfis,
exports ou bancos. Não é necessário copiar o repositório para sincronizar.

## Caminhos por ambiente

| Ambiente | Contexto/código | Worktrees | Estado privado e cache |
| --- | --- | --- | --- |
| Mac | `~/Automation/skincos` | `~/Automation/.worktrees/skincos/admin/<tarefa>` | `~/Library/Application Support/skincos`, `~/Library/Caches/skincos` |
| Windows | `C:\CodexShared\Projetos\skincos` | `C:\CodexShared\Worktrees\skincos\admin\<tarefa>` | Custódia existente em `%LOCALAPPDATA%\Codex\skincos` e `C:\CodexRuntime\operator\admin\skincos` |
| Windows/WSL | Código encaminhado pelo gateway tipado existente | Identidade da tarefa Windows | Dependências e execução em Ubuntu-24.04; runtime de serviços existente em `/var/lib/skincos-runtime` e `/etc/skincos` |

`SKINCOS_WORKTREE_ROOT`, `SKINCOS_LOCAL_STATE_ROOT` e
`SKINCOS_LOCAL_CACHE_ROOT` permitem personalizar caminhos somente naquela
máquina. Não grave valores pessoais no arquivo compartilhado do Codex.
O ator Git `admin` preserva a convenção das branches; no Mac as pastas privadas
pertencem ao usuário macOS atual. CRM e Orb continuam em seus repos próprios.

## Comparar e sincronizar

No Mac use `python3 scripts/shared-workspace.py status`; no Windows use
`python scripts/shared-workspace.py status` (ou `py -3`, conforme a instalação).
O comando só lê metadados Git,
mostra branch, upstream, mudanças locais, worktrees e contagens ahead/behind.
Não acessa a rede, lê exports ou mostra URLs com material de autenticação.

Para atualizar a comparação, confira primeiro que `origin` é o repo esperado:

```sh
git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
git status --short --branch
git rev-list --left-right --count HEAD...origin/main
```

O fetch não atualiza os arquivos do checkout. Não use `pull`, `reset`, cópia de
pastas ou um clone mais novo para resolver divergência automaticamente.
Com `main` limpo, sem commits exclusivos e o trabalho de ambos os computadores
conferido, `git merge --ff-only origin/main` atualiza apenas por fast-forward.
Uma branch com commits exclusivos, mesmo já removida no GitHub, deve ser
preservada e revisada antes de qualquer decisão de integração ou remoção.
Arquivos ignorados não são avaliados pelo status e podem ser únicos e privados.

Cada tarefa usa `codex/admin/<tarefa>` e um worktree próprio baseado no
`origin/main` conferido. No Windows use `scripts/new-shared-worktree.ps1` e
`scripts/validate-skincos-worktree.ps1`. No Mac use o Git existente:

```sh
git worktree add --no-track -b codex/admin/minha-tarefa "$HOME/Automation/.worktrees/skincos/admin/minha-tarefa" origin/main
cd "$HOME/Automation/.worktrees/skincos/admin/minha-tarefa"
python3 scripts/shared-workspace.py validate-worktree --task-slug minha-tarefa
```

Para uma raiz personalizada passe também `--worktree-root` ao validador.
Worktrees compartilham o armazenamento de objetos Git; não são clones extras.
Tarefas pequenas podem usar sparse checkout. Não remova worktrees de outras
tarefas. O fluxo de publicação continua branch/PR e os gates existentes; um
upstream ausente em uma branch nova é esperado até sua publicação autorizada.

## Preparação local no Mac

```sh
python3 scripts/shared-workspace.py setup
```

Sem `--apply`, o comando mostra somente os caminhos propostos. Com `--apply`,
cria apenas pastas vazias privadas fora dos worktrees. Recusa pastas existentes
com permissões amplas, sem mudar suas permissões ou mover dados. Não instala
dependências, altera Git global, autentica ou inicia serviços. No Windows use
o setup PowerShell existente, que aplica a política de ACLs apropriada.

Para escolher diretórios locais da integração EF na sessão POSIX atual:

```sh
eval "$(python3 scripts/shared-workspace.py environment)"
```

O comando emite apenas caminhos derivados, com quoting shell, para
`npm_config_cache`, `EF_SCRAPER_VENV_DIR`, `EF_OUTPUT_DIR`, `EF_DEBUG_DIR`,
`EF_LOG_DIR` e `EF_CHROME_USER_DATA_DIR`. Não carrega segredos ou perfis existentes. O venv é
separado por sistema, arquitetura, versão Python e hash de `requirements.lock`, permitindo
reuso entre worktrees compatíveis no mesmo computador. Alterar o lockfile
seleciona outro caminho; não apaga o venv anterior.

`integration/ef/scripts/setup-local-venv.sh` e `run-local-python.sh` respeitam
`EF_SCRAPER_VENV_DIR`; sem override mantêm o comportamento atual `.venv`.
O setup de dependências continua sendo uma ação explícita. O Mac usa Python e
Node nativos para trabalho local; Windows continua executando ferramentas de
projeto exclusivamente pelo gateway WSL. Nunca copie `.venv`, `node_modules`
ou caches entre sistemas. As exclusões existentes de `.gitignore` continuam
válidas. Não execute coleta EF, login, booking ou dados reais apenas para
comprovar que o ambiente foi preparado.

As ações Windows compartilhadas de `.codex/environments/environment.toml`
continuam intactas até validar a adaptação também no Windows. No Mac os
comandos acima funcionam no terminal sem instalar PowerShell.
