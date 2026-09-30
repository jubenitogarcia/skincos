# Checkpoint nativo dos gatilhos do GitHub Actions

`scripts/codex-native-actions-cutover.mjs` captura o estado live de `main`,
permissões, regras e catálogo de workflows antes de qualquer alteração. O
snapshot fica em `~/.local/state/skincos-actions-cutover/`, com diretórios
`0700` e arquivos `0600`. O script exige que o commit live de `main` esteja
disponível localmente e lê os gatilhos dessa revisão exata.

Use Ubuntu nativo por `scripts/invoke-skincos-wsl.ps1`:

```powershell
& .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path `
  -Executable node -Argument @('scripts/codex-native-actions-cutover.mjs', 'snapshot')
```

A saída informa caminho e fingerprint do checkpoint. `event-only` contém apenas
gatilhos automáticos de eventos e `workflow_dispatch`. `mixed-duty` compartilha
eventos de PR/push com `schedule` ou `workflow_run`; `safety-gate` protege o
merge; `unclassified` não tem fonte comprovada no `main`. **Nenhuma dessas três
classes é desabilitada pelo modo parcial.** O snapshot não dispara workflows.

O modo `disable-event-only --snapshot <caminho> --fingerprint <digest>` só
desativa os IDs previamente ativos da classe `event-only`. Reconsulta `main`,
regras, permissões e estados; aborta se algo mudou. Antes da primeira mutação,
grava `journal.json` com todos os IDs originalmente ativos. Após cada chamada,
confirma `disabled_manually` e atualiza o journal. Uma falha deixa o journal em
`interrupted-needs-restore`; o operador deve usar `restore` e confirmar o
readback. `restore` reativa somente os IDs do snapshot que estavam ativos e
exige que `main` continue no mesmo SHA. Se `main` mudou, a recuperação exige
revisão manual dos gatilhos antes de reativá-los.

Os dois modos de mutação adquirem `merge:main` no coordenador global e
revalidam o fencing antes de cada chamada. Exigem custódia nativa ativa por
variáveis privadas, sem transportar segredos por argv, arquivo do repositório
ou saída. A ausência da custódia bloqueia a mutação.

```powershell
& .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path `
  -Executable node -Argument @('scripts/codex-native-actions-cutover.mjs',
    'restore', '--snapshot', '<caminho>', '--fingerprint', '<digest>')
```

O corte parcial **não libera push, abertura de PR ou merge** enquanto houver
`mixed-duty`, `safety-gate` ou `unclassified` que possam iniciar jobs. Para
esses workflows, publicar primeiro o substituto nativo da rotina agendada,
watchdog ou proteção, provar seu funcionamento e retirar o gatilho automático
por mudança versionada. A primeira PR que instala a autoridade nativa requer o
bootstrap independente descrito em `native-merge-authority.md`; desabilitar um
workflow de proteção antes disso removeria uma defesa ativa. Não desabilitar o
Actions do repositório inteiro enquanto schedules, escritores e recuperações
dependerem dele.

## Continuidade das PRs abertas

`scripts/codex-native-pr-admission-inventory.mjs` lê todas as PRs abertas e
compara cada cabeça com o `main` live, sem alterar branches, statuses ou jobs.
O relatório privado registra apenas identidade de SHA, número da PR,
ancestralidade e estado de draft. A cabeça precisa conter o `main` atual,
pertencer ao mesmo repositório e, para o gate nativo versionado, a âncora de
base informada pela API também precisa coincidir com esse SHA. Uma PR antiga
deve ser atualizada e validada de novo no SHA resultante, somente depois que
os gatilhos automáticos forem neutralizados.

```powershell
& .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path `
  -Executable node -Argument @('scripts/codex-native-pr-admission-inventory.mjs')
```

Na leitura de 2026-09-30, o `main` era `cc7b7e496457a612cb63a9728233e52cc98cb3c3`:
60 PRs não draft estavam divergentes desse commit, sete eram draft e nenhuma
era elegível ao gate nativo sem atualização. Este número é um retrato, não um
estado fixo nem autorização para atualizar branches automaticamente.

## Auditoria arquitetural agendada

`scripts/codex-native-architecture-governance.mjs` executa o plano **completo**
de sete grupos e 22 comandos da auditoria arquitetural em uma cópia nativa do
SHA exato de `main`. Instala dependências do lockfile sem scripts de instalação
e sem variáveis de autenticação; cada verificação roda em sandbox de systemd,
com rede privada e fonte somente leitura. Guarda recibo privado de sucesso ou
falha. O plano inclui dois contratos que estavam no workflow histórico mas
faltavam na tabela de comandos: política de fonte de promoção e ambiente
dedicado do Ponto Pages.

```powershell
& .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path `
  -Executable node -Argument @('scripts/codex-native-architecture-governance.mjs', 'plan')
```

O modo `run` exige checkout limpo no SHA live de `main`; a instalação do timer
nativo e uma execução terminal de todos os 22 comandos ainda são necessários
antes de retirar o `schedule` do workflow histórico. O modo `plan` é só uma
verificação estática, não comprova a auditoria agendada.
