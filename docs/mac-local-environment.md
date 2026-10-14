# Atalhos locais do Codex no macOS

No macOS, as cinco ações em `.codex/environments/environment.toml` chamam
`scripts/run-local-codex-shortcut.sh`. O arquivo mantém comandos Windows
separados por `platform = "darwin"` e `platform = "win32"`. As ações Windows
continuam usando os gateways PowerShell e WSL já existentes.

| Ação | Comportamento no macOS |
| --- | --- |
| Workspace | Diagnostica Git/worktrees, ferramentas nativas, espaço em disco, venv EF e configuração de hooks, sem criar arquivos ou iniciar serviços. |
| Contexto | Imprime o snapshot de contexto do checkout atual. |
| Codex – Autônomo | Abre `codex --cd <worktree>` com as configurações já escolhidas pelo operador. |
| EF App | Inicia o menu interativo pelo venv privado selecionado por `shared-workspace.py`. Não faz login ou coleta até a escolha explícita no menu. |
| Orb | Abre o repositório independente do Orb no GitHub; não cria clone nem opera workflows. |

Para conferir os contratos sem abrir Codex, navegador, menu EF ou servidor,
execute:

```sh
for action in workspace context autonomous ef-app orb; do
  bash scripts/run-local-codex-shortcut.sh "$action" --dry-run
done
```

O `--dry-run` verifica o executável e o helper necessários para a ação, sem
abrir interfaces. Antes de usar EF, prepare os diretórios privados e o venv conforme
[ambientes locais por computador](shared-local-environments.md).

O diagnóstico Workspace retorna JSON e código `1` enquanto faltar alguma
dependência local necessária. Isso informa a preparação pendente sem iniciar a
prévia nem instalar dependências.

## Preparação privada

No worktree, crie somente as pastas privadas previstas para este Mac e depois
selecione o venv EF derivado do lockfile:

```sh
python3 scripts/shared-workspace.py setup --apply
eval "$(python3 scripts/shared-workspace.py environment)"
bash integration/ef/scripts/setup-local-venv.sh
```

O último comando instala dependências apenas no cache privado indicado por
`EF_SCRAPER_VENV_DIR`. O Workspace exige pelo menos 5 GiB livres antes de
reportar o ambiente como preparado.

## Website independente

A fonte, os testes e o publisher do Website pertencem a
`jubenitogarcia/website`. Os atalhos deste monorepo não iniciam uma prévia do
site; essa fronteira de fonte não declara corte do runtime Cloudflare.

## Hooks privados e credenciais EF

Os wrappers locais de Git são privados e aplicam-se a todos os worktrees deste
clone, pois `core.hooksPath` fica no Git comum local. Eles encaminham somente
`pre-commit` e `pre-push` aos hooks versionados e exportam
`SKINCOS_SKIP_DEPLOY=1` para impedir deploy pelo hook.

```sh
python3 scripts/install-local-git-hooks.py status --project-root .
python3 scripts/install-local-git-hooks.py install --project-root .
python3 scripts/install-local-git-hooks.py restore --project-root .
```

O status só é preparado quando o instalador confirma que possui os wrappers.
O menu EF só verifica credenciais quando uma operação que exige login é
selecionada; elas podem vir das variáveis `EF_LOGIN_EMAIL` e
`EF_LOGIN_PASSWORD`, de `EF_LOGIN_ENV_FILE` privado ou do keychain. O
Workspace não lê, mostra ou cria credenciais.

Para validar a seleção de unidade do runner EF comum:

```sh
cd integration/ef
"$EF_SCRAPER_VENV_DIR/bin/python" -B -m unittest test_auth_unit_selection
```
