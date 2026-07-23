# Eventos entre domínios

## Estado atual

Esta é uma fundação **desativada por padrão**. Nenhuma fila, Worker, cron ou consumidor foi publicado, nenhum binding remoto foi criado e nenhuma operação de origem passou a depender de um consumidor. O catálogo é [ops/events/event-catalog.json](../../ops/events/event-catalog.json); o envelope `skincos-event/v1` é implementado em [shared/events/v1.js](../../shared/events/v1.js).

O contrato começa pelos fluxos Atendimento, Clientes, Financeiro, Inventory e Marketing. Clientes é o componente `clientes` do domínio CRM enquanto a sua separação física ainda não recebeu banco/processo próprios. Os eventos contêm IDs e fatos operacionais mínimos, nunca PII, tokens, cookies, sessão ou credenciais.

O adaptador [shared/events/d1.js](../../shared/events/d1.js) constrói apenas os `INSERT OR IGNORE` aprovados para outbox/inbox D1 e só considera `EVENTS_OUTBOX_ENABLED=true` como liberação. Ele não entrega evento, não chama rede e não inicia consumidor; a aplicação da origem o adicionará à sua batch transacional no P0.

| Evento | Origem | Consumidores iniciais | Efeito se consumidor falhar |
| --- | --- | --- | --- |
| `attendance.completed.v1` | CRM/Atendimento | CRM/Clientes, Financeiro, Marketing | Atendimento permanece concluído; projeção entra em retry/DLQ. |
| `client.identity-reconciled.v1` | CRM/Clientes | CRM/Atendimento, Marketing | Reconciliação canônica permanece válida; projeções antigas ficam até o replay. |
| `finance.movement-posted.v1` | Financeiro | CRM/Clientes, Marketing | Movimento/razão continua postado; consumidores conciliam pelo watermark. |
| `inventory.stock-changed.v1` | Inventory | CRM/Atendimento, Marketing | Ledger de estoque continua autoritativo; disponibilidade é marcada como potencialmente defasada. |
| `marketing.conversion-requested.v1` | CRM/Atendimento | Marketing | Desfecho do atendimento não é repetido; somente o pedido de conversão é reprocessado. |

## Contrato operacional

1. A mutação da origem e o `INSERT` no seu outbox pertencem à mesma transação. Se a transação não confirmar, não há evento; se confirmar, há registro para entrega posterior.
2. O dispatcher lê e faz lease de registros já confirmados. Ele nunca é chamado no caminho HTTP da mutação e nunca faz chamada síncrona para um consumidor.
3. A entrega é **at-least-once**. Cada consumidor grava a chave `(consumer_name, event_id)` no inbox na mesma transação da sua projeção; conflito dessa chave significa sucesso idempotente, não nova execução.
4. Falhas transitórias usam 8 tentativas controladas: 30 s, 60 s, 120 s, 240 s, 480 s, 960 s, 1920 s e 3600 s. Falhas não recuperáveis ou a oitava falha vão para o dead-letter queue local do consumidor.
5. DLQ não é descarte: possui payload, erro, tentativas e resolução. Reprocessamento cria nova tentativa do mesmo `event_id`; não cria nova mutação na origem.
6. Reconciliação compara origem e projeção por intervalo/watermark, registra contagens e apenas reenvia eventos faltantes. Ela é o caminho de recuperação depois de indisponibilidade prolongada, não uma migração de dados entre domínios.

Os esquemas aditivos são: Financeiro `0013_event_outbox.sql`, Inventory `0017_event_outbox.sql`, CRM `20260723_event_outbox.sql` e Marketing `0002_event_inbox.sql`. Cada um permanece no banco do próprio domínio; nenhum consumidor ganha acesso direto ao banco do produtor.

## Ordem de ativação

| Prioridade | Mudança | Dependência / aceite |
| --- | --- | --- |
| P0 | Aplicar somente as migrations aditivas em staging e manter `EVENTS_OUTBOX_ENABLED=false`. | Backup/journal do domínio, validação da migration e nenhuma alteração de tráfego. |
| P0 | Implementar writer de outbox dentro das transações de `finance.movement-posted`, `inventory.stock-changed` e `attendance.completed`. | Teste prova que falha do writer aborta somente a origem; flag ainda desligada em produção. |
| P1 | Promover dispatcher canônico por produtor e inbox/DLQ por consumidor no staging. | Lease concorrente, retry, duplicata, DLQ e sem chamada no request path. |
| P1 | Ligar um fluxo por vez: Financeiro→Marketing, Inventory→Atendimento, Atendimento→Clientes, então Atendimento→Marketing. | Smoke de origem, métrica de atraso, DLQ vazia ou justificada e reconciliação `matched`. |
| P2 | Canary por artefato imutável e promoção para produção com flag por fluxo. | Aprovação explícita de produção, rollback do artefato e flag documentados. |
| P3 | Separar Clientes em seu próprio processo/banco e substituir a projeção interna CRM por consumidor remoto. | Contrato de ator/cliente estável, backfill conciliado e rollback por flag. |

## Regras de rollback e observabilidade

- Rollback de comportamento é desligar a flag do fluxo e promover o artefato anterior; migrations/outbox/inbox são preservados e não sofrem rollback destrutivo.
- Antes de mudar produção, exigir smoke da origem, medição de `pending`, idade do evento mais antigo, tentativas, DLQ aberta e último reconciliation `matched`.
- Cada dispatcher terá concorrência por produtor+ambiente. Staging e produção terão bindings, filas, segredos, watermarks e DLQs separados.
- Um consumidor não pode materializar lançamento financeiro, ajuste de estoque ou alteração de atendimento automaticamente sem uma política explícita do seu domínio. Eventos criam referências/projeções; comandos críticos continuam autorizados no domínio dono.
