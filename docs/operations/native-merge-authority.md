# Autoridade nativa de validação e merge

O caminho alternativo ao GitHub Actions para uma PR SKINCOS é
`scripts/codex-native-merge-gate.mjs`, executado por Codex no Ubuntu nativo via
`scripts/invoke-skincos-wsl.ps1`. A implementação de merge continua em
`scripts/codex-global-merge-authority.mjs`. O comando nativo gera evidência em
memória e a entrega diretamente à autoridade no mesmo processo; um arquivo de
resultado editável não autoriza merge.

## Fonte e entradas

- Execute o script de um checkout **limpo** cujo `HEAD` seja o SHA exato de
  `main` remoto. A PR deve pertencer ao mesmo repositório e ter base nesse SHA.
- Informe um segundo worktree limpo no SHA exato da cabeça da PR. O gate
  compara o diff local ao conjunto de caminhos da API do GitHub, inclusive
  caminhos antigos em renames.
- A classificação usa a política do checkout confiável em `main`. O plano
  executa `git diff --check`, parse estático, os contratos de baseline e
  governança equivalentes aos do gate anterior, e validação de domínio para
  outras superfícies. Mudança crítica ou não classificada falha fechada.
- Os processos que executam código da PR rodam em unidade transitória
  `systemd-run` com `DynamicUser`, rede privada, checkout somente leitura,
  `ProtectHome` e montagens Windows, runtime e segredos inacessíveis. Se esse
  isolamento não estiver disponível, a validação falha fechada.
- O gate grava um recibo privado criado uma vez por digest em
  `~/.local/state/skincos-native-merge-receipts/`. O recibo registra base,
  cabeça, closure, classificação, comandos e resultados. É somente leitura e
  vinculado pelo SHA-256; a autoridade o relê antes da mutação.

Exemplo sem mutação remota (ajuste os dois caminhos e os SHAs já verificados):

```powershell
$mainRoot = 'C:\Users\admin\.codex\worktrees\skincos-trusted-main'
$candidateWsl = '/mnt/c/Users/admin/.codex/worktrees/skincos-reviewed-pr'
& "$mainRoot\scripts\invoke-skincos-wsl.ps1" -ProjectRoot $mainRoot `
  -Executable node `
  -Argument @('scripts/codex-native-merge-gate.mjs', '--pull-number', '123',
    '--expected-head-sha', '<SHA-HEAD-COMPLETO>', '--candidate-root', $candidateWsl) `
  -EnvVar @('GITHUB_REPOSITORY=jubenitogarcia/skincos')
```

Após validar os requisitos abaixo, acrescente `--merge` ao `-Argument`. O
comando então obtém `merge:main`, revalida PR/base/head, closure e fencing antes
do `PUT /merge`, usa somente squash e confirma por leitura da PR, `main` e do
parent do commit criado. Depois do readback, publica
`codex-native-merge-result` com o prefixo do digest do recibo. Não publica um
status verde de autorização antes do merge. Falha de leitura, lease,
validação ou reconciliação mantém a mutação bloqueada.

## Pré-condições de cutover

1. Ler o ruleset **live** de `main` e migrar required checks para evidência
   independente quando exigidos. O ruleset versionado e o histórico de um
   check não provam a proteção live. Um GitHub App com permissões e ownership
   compatíveis é necessário para fechar a restrição de update de `main`; um PAT
   pessoal não equivale a esse actor.
2. Garantir custódia privada do segredo ativo de coordenação no executor nativo
   e token GitHub com permissões de leitura do catálogo/Administration, escrita
   em commit statuses e merge de PR. `gh auth token` é lido em memória; nunca
   passar tokens por `-Argument`, `-EnvVar`, argv, log ou repositório. A ausência
   desses acessos falha fechada e deve ser resolvida na custódia canônica.
3. Antes de qualquer push/PR de migração, neutralizar gatilhos Actions que
   seriam disparados por esse evento; `[skip ci]` não neutraliza
   `pull_request_target`. Antes de cada merge, o script consulta permissões e
   catálogo de workflows **live** e recusa a mutação se algum workflow ativo
   puder iniciar em `push`, `status`, `delete` ou `pull_request` fechado. A
   inspeção é repetida imediatamente antes do `PUT /merge`, contra uma cópia
   local do SHA exato da cabeça da PR. Um workflow cadastrado e
   `disabled_manually` pode permanecer no arquivo; um novo workflow com
   gatilho automático de merge falha fechado. Workflows ativos que não existem
   no checkout confiável também bloqueiam, pois seu efeito sobre o orçamento
   não está comprovado. A emissão do status também é protegida contra eventos
   `status`, `check_run` e `check_suite`.
4. Preservar o checkpoint do ruleset, lista/estado de workflows, SHA de `main`
   e releases afetadas antes de alterar governança remota. Não reduzir gates de
   review, staging, rollback e readback para contornar um status indisponível.

Inventário de gatilhos, sem conteúdo de workflow:

```powershell
& "$mainRoot\scripts\invoke-skincos-wsl.ps1" -ProjectRoot $mainRoot `
  -Executable node -Argument @('scripts/codex-native-actions-audit.mjs') `
  -EnvVar @('GITHUB_REPOSITORY=jubenitogarcia/skincos')
```

Esse inventário é um snapshot. Releia as permissões, workflows e ruleset no
momento da operação. O modo `--merge` não está pronto para produção enquanto
gatilhos de merge Actions estiverem ativos ou a custódia e o actor de GitHub
necessários não tiverem sido comprovados.

## Primeira PR e bootstrap

A primeira PR que instala estes arquivos não pode usar seu próprio gate com
credenciais. Revise o diff e valide a cabeça exata em sandbox sem credenciais,
com o mesmo plano de checks acima. Registre um recibo privado com SHA de
`main`, SHA da cabeça, digest da closure, comandos e resultados. Só após
neutralizar os gatilhos Actions e confirmar os states por leitura, use a
autoridade já presente no checkout limpo de `main`; ela verifica lease,
base/cabeça, closure e readback. Execute de um worktree isolado no SHA exato de
`main` remoto, nunca do checkout compartilhado defasado:

```powershell
$mainRoot = 'C:\Users\admin\.codex\worktrees\skincos-trusted-main'
& "$mainRoot\scripts\invoke-skincos-wsl.ps1" -ProjectRoot $mainRoot `
  -Executable node `
  -Argument @('scripts/codex-global-merge-authority.mjs', '--pull-number', '123',
    '--expected-head-sha', '<SHA-HEAD-COMPLETO>', '--merge-method', 'squash') `
  -EnvVar @('GITHUB_REPOSITORY=jubenitogarcia/skincos')
```

O comando só é elegível quando a custódia de token GitHub/status e chave ativa
de coordenação estiver injetada pelo mecanismo privado do operador; nenhum
segredo passa por argv ou pelo repositório. A revisão e o recibo de validação
do bootstrap são pré-condições verificáveis; o comando sozinho não valida
código da PR. Depois do primeiro merge, use sempre o gate nativo versionado em
`main`. O token pessoal `gh` não substitui o GitHub App com custódia e
permissão de update necessários para endurecer o ruleset no futuro.
