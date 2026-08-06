# Workspace de clusters de identidade — Clientes

Este runbook descreve a operação do workspace de revisão de identidades por componentes do grafo. A mudança é somente de revisão e governança: não abre escrita comercial, não envia mensagens e não executa campanha.

## Contrato operacional

- Schema de resposta: `crm-identity-cluster/v1`.
- A unidade de agrupamento é um componente transitivo de registros de Atendimento, Caixa, cadastro do app e leads/planilhas, incluindo aliases, decisões, materializações, vínculos automáticos e alterações posteriores da fonte.
- A API retorna somente DTOs explícitos. Chaves técnicas, `context`, `evidence` arbitrário, telefone e e-mail brutos não são renderizados.
- Telefone e e-mail aparecem mascarados; o reveal exige ação explícita, justificativa, confirmação, versão otimista e permissão de gestor. O ledger guarda apenas digest da justificativa e campos revelados.
- O escopo de unidade é aplicado ao componente inteiro. Se um membro não puder ser provado dentro do escopo do ator, o componente é ocultado/falha fechado.
- Nenhuma ausência de uma fonte autoriza exclusão, aposentadoria ou merge automático.

## Pré-requisitos e migration

A migration é aditiva e separada do bootstrap HTTP. Ela exige o schema de identidade e os ledgers predecessores já disponíveis e só aceita os destinos locais/staging explicitamente permitidos pelo `migrationDestination.js`.

```text
scripts/invoke-skincos-wsl.ps1 \
  -ProjectRoot C:\CodexShared\Worktrees\skincos\admin\clientes-identity-cluster-workspace-20260806 \
  -WorkingDirectory crm/api \
  -Executable npm \
  -Argument @('run','migrate-atendimento-identity-clusters','--','--plan')
```

Para aplicar, substitua `--plan` por `--apply` somente no espelho local ou em staging isolado. Para staging, acrescente `--target=staging` e forneça a URL loopback TLS do migrator autorizada. O processo rejeita TCP/URL fora da allowlist antes de abrir a conexão. A role de runtime recebe somente `USAGE` e `SELECT, INSERT` nas tabelas novas; DDL permanece com a role de migration.

Rollback é não destrutivo: `--rollback` registra a migration como indisponível, desabilita escritas do workspace e preserva os ledgers para auditoria. Não remover tabelas nem apagar evidências.

## API e estados

- `GET /api/atendimento/commercial/identity-clusters`: fila paginada de componentes, filtros de unidade, busca, stale e resolvidos.
- `GET /api/atendimento/commercial/identity-clusters/:clusterKey`: detalhe independente, com lineage, impacto, bloqueios de undo, histórico e origem dos vínculos.
- `POST /api/atendimento/commercial/identity-clusters/bulk/preview`: simula apenas componentes determinísticos.
- `POST /api/atendimento/commercial/identity-clusters/bulk/apply`: exige `REVIEW_CLUSTER`, justificativa, `expectedVersions`, idempotency key e lock do grafo.
- `POST /api/atendimento/commercial/identity-clusters/:clusterKey/reveal`: exige justificativa, confirmação, versão e campos `phone`/`email`; a resposta expira em cinco minutos no cliente.

Estados de revisão são `pending`, `confirmed`, `rejected` e `stale`. Uma fonte alterada após a decisão reabre o componente como `stale`; nenhuma decisão stale é reaplicada em lote.

## Critério de revisão em lote

O preview marca `bulk_safe` somente quando há telefone ou e-mail validado compartilhado, candidato único, evidência determinística, ausência de conflito forte, ausência de decisão incompatível, ausência de histórico comercial/consentimento bloqueador e fonte atual. Todos os demais casos permanecem `individual_only`.

O apply é transacional, limitado a 50 componentes, usa lock por componente, valida versão atual e registra decisão, materialização, lineage, histórico de vínculo e auditoria append-only. Repetir a mesma chave idempotente retorna o resultado original; reutilizar a chave com outro payload é rejeitado.

## Smoke sintético

```text
scripts/invoke-skincos-wsl.ps1 \
  -ProjectRoot C:\CodexShared\Worktrees\skincos\admin\clientes-identity-cluster-workspace-20260806 \
  -Executable npm \
  -Argument @('run','--prefix','crm/console','test:e2e','--','--grep','synthetic identity cluster','--project','chromium-desktop') \
  -EnvVar @('E2E_START_SERVER=1','E2E_PORT=5187','E2E_BASE_URL=http://127.0.0.1:5187','CI=1','CODEX_SHELL=1')
```

O smoke usa somente identidades sintéticas, viewport móvel, mocks locais e verifica deep link, mascaramento, ausência de ID técnico, abertura do detalhe e lineage. Não reutilizar dados reais nem publicar artefatos de browser no repositório.

## Evidência e troubleshooting

1. Confirmar `workspace.ready` e `workflow.writesReady` na resposta; `false` é estado esperado antes da migration e deve manter a UI em leitura.
2. Confirmar `staleState`, `sourceChanges` e `bulkReview.reasons` antes de qualquer apply.
3. Em conflito de versão, recarregar o detalhe e simular novamente; não forçar a versão antiga.
4. Em `commercial_or_consent_history`, manter revisão individual e não tentar undo automático.
5. Para suspeita de PII em logs/métricas, interromper o smoke, preservar apenas hashes/contagens e auditar o endpoint de reveal.

## Escopo desta tranche

A branch não promove produção. A ativação posterior deve partir de `main`, aplicar a migration em ambiente isolado, executar o smoke no mesmo SHA e comprovar RBAC por unidade. Escrita comercial, canário, consentimento, contato e campanhas permanecem desativados.
