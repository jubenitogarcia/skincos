# Inventário da retirada do GitHub Actions — 2026-09-30

Este é um retrato de leitura autenticada do repositório
`jubenitogarcia/skincos`, não uma autorização para iniciar workflows. A
decisão vigente está em
[`github-actions-retirement.md`](../decisions/github-actions-retirement.md).
Antes de qualquer corte, reler o catálogo live, as regras de `main`, os
publishers e os destinos afetados.

## Estado observado

- GitHub Actions: habilitado; 95 workflows no catálogo, 92 ativos.
- Entre arquivos ativos versionados: 15 com `push`, 16 com `pull_request`,
  2 com `pull_request_target`, 4 com `workflow_run`, 13 com `schedule` e
  74 com `workflow_dispatch` (um workflow pode ter vários gatilhos).
- Ruleset de `main`: PR obrigatória, sem status check obrigatório observado
  e sem regra live de `update`. O payload versionado antigo não prova o
  estado remoto.
- Seis itens ativos não coincidiram com arquivo no `main` observado; devem
  ser classificados diretamente pela API antes de concluir que um evento
  não inicia Actions.

## Gatilhos automáticos a substituir

| Grupo | Quantidade | Substituto e prova antes de desativar |
| --- | ---: | --- |
| `push`, PR e `pull_request_target` | 33 incidências de gatilho | Gate nativo por SHA, sandbox para código de PR, merge com lease/readback e publisher de cada superfície. Fazer checkpoint do catálogo e desativar gatilhos antigos antes do PR de migração. |
| `workflow_run` | 4 | Retirar o rerun de CI; portar a construção de release imutável, o watchdog Ponto e a recuperação Beauty Movement para controladores nativos com disparo, compensação e prova terminal. |
| `schedule` | 13 | Migrar probes e auditorias para agendamento nativo; portar separadamente os writers de secrets, segurança Cloudflare, Instagram, manutenção de PR e status. Verificar se o smoke Escala escreve dados antes do corte. |
| `workflow_dispatch` | 74 | Inventariar por superfície. Não despachar como fallback; desativar após provar substituto e rollback da operação correspondente. |

Os schedules com efeito de escrita observados são `Sync Integrations
Encryption Secret`, `codex-keep-prs-mergeable`, `Sync Escala auth secret`,
`Sync Website Cloudflare Security`, `Website Instagram Sync` e
`SKINCOS integration gate recheck`. `uptime-slo` envia alerta externo;
`Escala API Smoke` ainda requer classificação de efeitos. Os quatro
`workflow_run` são `CI Auto Rerun`, `Prepare immutable release candidate`,
`Ponto progressive release watchdog` e `Recover Beauty Movement production
release`.

## Ordem de corte

1. Validar código e custódia dos caminhos nativos em Ubuntu, no SHA exato,
   sem executar código de PR com credenciais do operador.
2. Capturar IDs/estados dos workflows, ruleset, `main`, segredos por **nome**
   e versões incumbentes como rollback. Desativar os gatilhos que um push,
   abertura de PR, status ou merge de migração iniciariam.
3. Publicar as mudanças com `[skip ci]` nos commits e provar por readback que
   nenhum job novo foi iniciado. Integrar somente pela autoridade nativa,
   mantendo revisão, lease, fechamento e checks reais.
4. Migrar os schedules e as recuperações com efeito externo um por um.
   Provar execução normal, falha, interrupção, recuperação e readback antes de
   desligar cada writer antigo. Evitar dois writers para o mesmo recurso.
5. Desabilitar Actions no repositório somente quando nenhuma rotina necessária
   depender dele; confirmar permissões, catálogo e ausência de novos runs.

O estado observado acima não comprova que qualquer substituto já foi publicado
ou que o corte remoto ocorreu.
