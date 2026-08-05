# Clientes — paginação comercial e visões salvas

## Objetivo

A fila comercial do módulo Clientes usa a rota de overview com `server=1` para
evitar materializar todas as identidades no navegador. O banco calcula os
agregados, os percentis de referência, os filtros, a ordenação e o total antes
de devolver a página visível.

## Contrato

- `limit` é limitado pelo backend a 100 (a UI usa 50 por página); `offset` é
  não-negativo e a resposta informa `total` e `pagination.hasPrevious/hasNext`.
- `sort` aceita somente `priority`, `recency`, `lifetime_sales`, `visits`,
  `sales`, `last_attendance` e `name`; qualquer outro valor retorna ao padrão
  de prioridade. `direction` aceita apenas `asc` ou `desc`.
- `q`, `segment` e `priority` são aplicados na mesma consulta que produz o
  total. Os benchmarks P75 de faturamento e visitas são calculados sobre o
  conjunto filtrável completo, não sobre a página atual.
- A rota sem `server=1` continua disponível como compatibilidade para clientes
  antigos e mantém o comportamento legado limitado em memória.
- A elegibilidade de contato retornada no caminho SQL é explicitamente
  `scope: "page"`; ela nunca deve ser interpretada como contagem global da
  fila. O número de telefone continua removido do payload da tabela.

## Visões salvas

As visões salvas são preferências locais do navegador em
`skincos:clientes:saved-views`. Elas contêm somente unidade, filtros, busca e
ordenação; não guardam nomes, telefones, IDs de identidade, consentimentos ou
qualquer dado do cliente. A persistência é best-effort: indisponibilidade do
`localStorage` não impede a fila de funcionar. Há no máximo 12 visões e uma
visão com o mesmo nome é substituída de forma determinística.

## Rollback e promoção

O backend só usa a consulta paginada quando o chamador envia `server=1`, então o
rollback imediato é retirar esse parâmetro no console ou reverter a release;
nenhuma migration é necessária. A promoção deve manter o par backend/Pages na
mesma release: o frontend desta tranche requer o contrato `pagination` e a rota
`server=1`, enquanto callers legados permanecem compatíveis. Validar o health
do módulo, a resposta sintética de overview e a ausência de escrita de contato
antes de qualquer ambiente autorizado.

## Verificação

```bash
npm --prefix crm/api test
npm --prefix crm/console run test
npm --prefix crm/console run typecheck
npm --prefix crm/console run lint
npm --prefix crm/console run build
```
