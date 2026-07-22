# Matriz de completude operacional — Financeiro

_Atualizada em 2026-07-22. Esta matriz descreve código e testes existentes;
não é autorização para ativar o módulo em produção._

| Capacidade | Estado | Evidência atual | Lacuna antes da operação diária |
| --- | --- | --- | --- |
| Escopos, grants e pessoal inativo | Completa | `finance_scopes`, `finance_access_grants`, guardas no Worker e D1 tests | Consolidado empresarial ainda não tem contrato/relatório próprio. |
| Contas, categorias, favorecidos, tags e centros | Parcial | CRUD de criação/listagem/arquivamento; `FinanceModule` tem cadastros | Sem edição explícita, busca/paginação visual e gestão de conta de cartão. |
| Receita, despesa e transferência | Completa no núcleo | Worker, razão balanceada, estorno, idempotência e testes D1 | Ações em lote e filtros persistidos ainda não existem. |
| Rascunhos, splits e parcelas | Completa no núcleo / parcial na UI | revisão otimista, parcela individual e detalhe no CRM | Falta visão agrupada de parcelas e vencidas. |
| Auditoria e anexos | Parcial | auditoria append-only e metadados de anexo no domínio | UI não mostra anexo; não há upload privado nesta fase. |
| Importação CSV, MoneyWiz e Caixa EF | Completa para staging controlado | pipeline normalizado, deduplicação, decisão, commit/undo e smokes | histórico operacional e painel de saúde de integração ainda ausentes. |
| Conciliação | Parcial | linhas, sugestões, confirmação e testes D1; diálogo por lançamento | sem fila de divergências, ações em lote ou conector bancário. |
| Contas a pagar e receber | Backend apenas | `finance_obligations`, baixas parciais e cancelamento auditados; migration `0011` e D1 tests | Sem tela, calendário, aging, recorrência, previsão e drill-down. |
| Cartões | Schema apenas | tipo `card` como passivo no razão | sem fatura, fechamento, vencimento e liquidação. |
| Recorrências e planejamento | Ausente | nenhum contrato/migration/serviço | requer modelo aditivo de regra, ocorrências e realização sem duplicar razão. |
| Relatórios e DRE | Ausente | overview por escopo é apenas operacional | requer classificação gerencial versionada, agregações autorizadas e reconciliação com razão. |
| Backup, recuperação e observabilidade | Parcial | runbook D1 e `request_id`; staging isolado | falta export automatizado, restore drill e alertas Financeiro. |

## Ordem de implementação

1. Expor títulos (pagar/receber) no CRM sobre os endpoints existentes, com
   filtros, criação, baixa parcial, cancelamento e auditoria; não criar uma
   segunda persistência.
2. Criar previsões e recorrências como documentos não-postados, vinculando a
   realização ao lançamento confirmado existente.
3. Implementar fatura de cartão e conta de liquidação sobre o mesmo ledger.
4. Construir calendário, aging e fluxo realizado/projetado a partir de títulos
   e lançamentos oficiais.
5. Adicionar classificação DRE versionada e relatórios consolidados somente de
   escopos empresariais explicitamente concedidos.

Cada item precisa de migration aditiva quando houver dados novos, contrato
versionado, autorização por escopo, idempotência, auditoria, D1 tests, UI e
smoke antes de ser considerado concluído.
