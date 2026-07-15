# Orb engine agent rules

## Operator continuity

- This shared clone is the cross-account source of truth for code, exported
  snapshots, and operational documentation. It is not the live secret store.
- Before changing anything, read `AGENTS.md`, `CODEX_CONTEXT.md`, `TASKS.md`,
  and `DECISIONS.md`, then inspect `git status`.
- Use branches in the format `codex/<windows-user-or-alias>/<task-slug>`.
- Prefer worktrees under `C:\CodexShared\Worktrees\skincos\<actor>\<task-slug>`
  when parallel account work must change the umbrella repo.
- Never store `.env`, `.n8n`, `.cloudflared`, database copies, tokens, or
  Codex auth state inside `C:\CodexShared`.
- Live code is an immutable release under `/opt/skincos/current/source`.
- Runtime state belongs in `/var/lib/skincos-runtime/orb`, secrets in
  `/etc/skincos`, logs in `/var/log/skincos/orb` and native backups in
  `/var/backups/skincos/orb/daily`.
- No active process may use DrvFS, the shared checkout or a worktree.

## Fonte da verdade dos workflows

- A fonte da verdade deste projeto e' sempre o workflow mais atualizado visivel no browser do n8n.
- Quando o usuario disser apenas "workflow", assumir a versao mais recente no browser.
- Arquivos JSON em `workflows/` sao snapshots de trabalho e referencia auxiliar. Nao devem ser tratados como a versao canonica por padrao.
- Exports locais, exemplos antigos, logs de execucao e JSONs no repositorio podem estar defasados. Usar apenas se o usuario pedir explicitamente ou se tiverem sido exportados novamente a partir do estado atual.

## Ordem de precedencia

1. Workflow atual no browser do n8n, se o usuario indicar que ele e' a referencia.
2. Workflow salvo mais recentemente no n8n e exportado na hora para o workspace.
3. JSON local em `workflows/`, somente como snapshot temporario.
4. Documentacao, exemplos antigos e execucoes anteriores, apenas como contexto secundario.

## Regra operacional antes de editar

- Antes de alterar um workflow, preferir exportar novamente a versao atual do n8n para um arquivo local atualizado.
- Nao reaplicar mudancas sobre um JSON local antigo sem antes sincronizar com o estado mais recente.
- Se houver indicio de que o browser contem mudancas ainda nao salvas, parar e avisar que o Codex nao deve assumir que o JSON local reflete esse draft.
- Se o usuario mencionar "a versao do browser", interpretar como a versao mais atual disponivel no editor do n8n.
- Para bugs em workflow ativo, inspecionar a execucao mais recente, `execution_entity`,
  `execution_data`, banco local, runtime ou browser quando isso for aplicavel ao
  sintoma reportado.
- Se o usuario disser que o problema voltou, investigar o mecanismo de recorrencia
  antes de aplicar outro patch.

## Regra operacional depois de editar

- Depois de qualquer alteracao em workflow, atualizar tambem a versao canonica salva no n8n sempre que isso for tecnicamente possivel e fizer parte do pedido.
- Depois de atualizar a versao canonica no n8n, exportar novamente o workflow para `workflows/` para manter o snapshot local alinhado com o que aparece no browser.
- Evitar encerrar a tarefa com apenas um dos lados atualizado. O objetivo e' impedir divergencia entre browser, banco do n8n e JSON local.
- Se algum dos lados nao puder ser atualizado no momento, registrar explicitamente qual lado ficou pendente e por que.
- Depois de salvar workflow ou alterar comportamento de automacao, validar com a
  execucao mais direta disponivel: teste manual, execucao recente, logs, payload,
  banco local ou export atualizado.

## Autonomia e seguranca operacional

- O agente deve agir com autonomia quando o objetivo e' claro, mas deve criar
  checkpoint ou export antes de mudancas de alto risco.
- Mudancas no banco n8n, workflows ativos, credenciais, env de startup ou scripts
  de servico sao alto risco e exigem rollback pratico identificado.
- Nao alterar credenciais, tokens ou secrets sem instrucao explicita.

## Limitacao importante

- Se a mudanca existir apenas no browser e ainda nao tiver sido salva no n8n, o agente pode nao conseguir acessa-la automaticamente pelo workspace.
- Nessa situacao, a acao correta e' pedir para salvar no n8n ou exportar novamente antes de editar.
