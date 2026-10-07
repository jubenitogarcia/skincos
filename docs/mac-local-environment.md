# Atalhos locais do Codex no macOS

No macOS, as seis ações em `.codex/environments/environment.toml` chamam
`scripts/run-local-codex-shortcut.sh`. O arquivo mantém comandos Windows
separados por `platform = "darwin"` e `platform = "win32"`. As ações Windows
continuam usando os gateways PowerShell e WSL já existentes.

| Ação | Comportamento no macOS |
| --- | --- |
| Workspace | Diagnostica Git/worktrees, ferramentas nativas, espaço em disco, venv EF, cache da prévia e configuração de hooks, sem criar arquivos ou iniciar serviços. |
| Contexto | Imprime o snapshot de contexto do checkout atual. |
| Codex – Autônomo | Abre `codex --cd <worktree>` com as configurações já escolhidas pelo operador. |
| EF App | Inicia o menu interativo pelo venv privado selecionado por `shared-workspace.py`. Não faz login ou coleta até a escolha explícita no menu. |
| Orb | Abre o repositório independente do Orb no GitHub; não cria clone nem opera workflows. |
| Cartas da Beleza – Prévia Local | Inicia a prévia isolada em `scripts/mac-local-preview.py`. |

Para conferir os contratos sem abrir Codex, navegador, menu EF ou servidor,
execute:

```sh
for action in workspace context autonomous ef-app orb beauty-preview; do
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

## Prévia Cartas da Beleza

O atalho e o [start-website-local.command](../start-website-local.command)
usam o mesmo runner no macOS. Ele mantém cópia de runtime, `node_modules`,
cache npm, manifest e logs fora do worktree. Os comandos abaixo são explícitos:

```sh
python3 scripts/mac-local-preview.py prepare --project-root .
python3 scripts/mac-local-preview.py start --project-root .
python3 scripts/mac-local-preview.py status --project-root .
python3 scripts/mac-local-preview.py stop --project-root .
```

`prepare` e `start` podem instalar as dependências da prévia no cache privado;
`status` e `stop` não iniciam uma nova prévia. O diagnóstico Workspace só
aceita o cache quando o marker versionado, sua chave e `next`, `react` e
`react-dom` correspondem ao worktree atual.

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

Para rodar os contratos sintéticos do executor EF no Mac, canonicalize apenas
o diretório temporário dessa execução. O alias `/var` do macOS aponta para
`/private/var`; o ledger recusa pais com symlinks por segurança.

```sh
cd integration/ef
TMPDIR="$(python3 -c 'import tempfile; from pathlib import Path; print(Path(tempfile.gettempdir()).resolve())')" \
  "$EF_SCRAPER_VENV_DIR/bin/python" -B -m unittest \
  test_booking_executor tests_test_booking test_auth_unit_selection
```
