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
