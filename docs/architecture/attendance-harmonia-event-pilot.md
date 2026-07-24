# Piloto de eventos: Atendimento para Harmonia

O primeiro fluxo é `atendimento.commercial-action.created.v1`: ao criar uma
ação comercial, Atendimento grava a ação, a auditoria, o outbox e a entrega
para `harmonia.attendance-signal.v1` na mesma transação PostgreSQL. O payload
contém somente IDs e classificação operacional; não leva nome, telefone ou
anotações do cliente.

Harmonia grava uma projeção interna (`attendance_signals`) e o inbox idempotente.
Não cria tarefa, não chama WhatsApp e não altera o resultado da ação de
Atendimento. A flag `EVENTS_ATTENDANCE_HARMONIA_SIGNALS_ENABLED` permanece
desligada por padrão.

Entregas têm lease recuperável de 60 segundos, atraso exponencial, máximo de três
tentativas, DLQ no registro de entrega, replay manual e reconciliação de entregas
faltantes ou marcadas como entregues sem inbox. O worker trata falhas do consumidor
separadamente das tarefas Harmonia: uma indisponibilidade deixa a ação comercial
confirmada e a entrega pendente/retrying ou em dead letter.

Antes de qualquer fluxo para Financeiro, Inventory, Clientes ou Marketing,
validar em staging a flag, duplicidade, atraso, indisponibilidade, retry, DLQ,
replay e reconciliação. Com uma credencial de staging, usar
`npm run reconcile-attendance-event-deliveries` e, somente para um evento
identificado na DLQ, `EVENT_ID=<uuid> npm run replay-attendance-event-dead-letter`.
Não há ativação nem replay automático em produção.
