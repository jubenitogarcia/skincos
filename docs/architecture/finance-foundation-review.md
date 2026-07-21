# Revisão crítica da fundação Financeiro

## Correções desta revisão

- O mount `/finance` deixou de entrar no Worker de Inventário, que aplicava uma unidade padrão antes de o Financeiro validar o próprio escopo.
- A sessão e CSRF continuam sendo CRM, através de `shared/crm-auth`; não há segundo login ou cookie.
- Contas operacionais agora têm contas de razão; receitas, despesas e transferências criam débito/crédito em contas distintas e balanceadas.
- A migration inclui parcelas, relação movimento-tag, candidatos de duplicidade e idempotência vinculada a ator, rota e escopo.
- O deploy deixou de executar migration Financeiro como efeito colateral de qualquer alteração em Inventário.

## Limites assumidos nesta entrega

- O adaptador de identidade importa temporariamente `d1GetUserByUsername` de `inventory/src/d1Store.js`. É dependência técnica de leitura, não delegação de rota nem regra de Financeiro; a extração do repositório de identidade para `shared` continua pendente.
- CSV suporta cabeçalhos convencionais e staging com duplicidade exata. Mapeamento interativo, candidatos prováveis, revisão/decisão de duplicidade e commit atômico em lote ainda exigem a próxima etapa.
- Conciliação, anexos, tags, centros de custo, parcelas e conectores externos têm schema, mas não rotas operacionais nesta fase.
- A auditoria é append-only por convenção de handler; a proteção D1 contra `UPDATE`/`DELETE` deve ser estabelecida pelo processo operacional ou por gatilhos em migration posterior.

## Critério de ativação

Permanece não ativável: migration não foi aplicada em staging, não há teste de integração D1/CSV, a UI não oferece mapeamento/confirmação de lote, e não existe smoke autenticado de staging. A flag inicia desligada e nenhum grant é criado.
