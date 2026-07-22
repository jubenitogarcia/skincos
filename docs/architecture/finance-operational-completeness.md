# Matriz de completude operacional — Financeiro

Atualizada em 2026-07-22. Esta matriz descreve código e testes presentes nesta
branch; não é evidência de produção. A flag continua desligada fora dos testes
controlados e o contexto pessoal continua inativo.

| Requisito | Estado | Evidência atual | Próxima pendência |
| --- | --- | --- | --- |
| Isolamento NH/BSS e pessoal bloqueado | Implementado e testado | grants explícitos, `finance_scopes.active`, handler e testes D1 | smoke de navegador local ainda precisa completar sem interrupção do runner |
| Contas, categorias, favorecidos, tags e centros de custo | Criação, leitura e arquivamento implementados | rotas de cadastros, `POST /:collection/:id/archive`, auditoria e CRM Cadastros | renomear com política de referência e lista de arquivados para restauração na UI |
| Receita, despesa e transferência | Implementado e testado | `finance_movements`, `buildPostedJournal`, D1 para balanceamento | regras específicas de fechamento/fatura de cartão |
| Splits, parcelas, competência e moedas | Implementado e testado | `finance_movement_splits`, `finance_installments`, minor units, ppm | calendário operacional e fluxo completo de contas a pagar/receber |
| Rascunho editável sem alterar evidência | Implementado neste ciclo | migration `0008`, `PUT /movements/:id`, revisão otimista, auditoria e testes D1/CRM | teste visual headless do diálogo de revisão |
| Confirmar, conciliar, estornar e auditar | Implementado e testado | transições auditadas, razão/estorno append-only, linha de extrato e match 1:1 | conciliação parcial, lote de extrato e regras de divergência/AP-AR |
| Anexos | Apenas metadados | `finance_attachments`, validação de chave/tipo/tamanho | upload privado R2, antivírus, leitura assinada e UI |
| CSV, MoneyWiz e Caixa EF | Pipeline de staging implementado | adapters normalizam para staging, decisão, commit, undo e D1 tests | histórico de lotes na UI e revisão operacional ampliada |
| Conciliação manual | Implementada para vínculo 1:1 | `/reconciliation/lines`, sugestões exatas, confirmação auditada e diálogo no detalhe | importação de extrato, divergência parcial e ações em lote |
| Filtros, paginação, busca e auditoria | Implementado para movimentações | filtros enviados à API, paginação, detalhes/auditoria no CRM | persistência de filtros e ações em lote |
| Regras de cartão, recorrência e contas a pagar/receber | Estruturado parcialmente | tipo `card`, parcelas, vencimento, pagamento | modelo e endpoints próprios de fatura, recorrência, aging e liquidação |
| Relatórios gerenciais | Visão geral inicial | `/overview`, saldos, entradas, saídas e período anterior | DRE, fluxo de caixa, competência/caixa e exportações seguras |
| Backup, recuperação e observabilidade de produção | Não concluído | docs de segurança registram a dependência | exercício de backup/restauração D1, alertas e runbook |

## Decisão deste ciclo

O rascunho pendente é dado operacional transitório; por isso pode ser
substituído somente como uma revisão integral, versionada e idempotente. Depois
da confirmação, o lançamento é evidência: qualquer correção continua sendo
estorno auditável, não edição. A migration é aditiva e não altera linhas ou
auditoria já existentes.

## Critério de ativação

Este trabalho não muda o critério: produção permanece não ativável até
backup/restauração exercitados, observabilidade verificada, smoke autenticado
estável e novo ciclo de staging com migrations aditivas aplicadas. Não há
concessão automática por papel e o contexto pessoal segue bloqueado.
