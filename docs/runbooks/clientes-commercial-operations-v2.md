# Clientes — Operações Comerciais v2

Este runbook descreve o backend de operação comercial interna. Ele não
autoriza promoção, escrita de consentimento, envio de mensagens, automação de
campanha ou alteração de regras clínicas. A tranche mantém todos estes
controles desligados por contrato, independentemente de variável de ambiente:

```json
{
  "commercialContactWritesEnabled": false,
  "messagesEnabled": false,
  "automationEnabled": false,
  "consentWritesEnabled": false,
  "outboundDispatchEnabled": false
}
```

Nenhuma rota v2 chama Harmonia, provider de WhatsApp, shell, fila de entrega,
cadência clínica ou o gravador de permissões. `opt_out_requested` é somente um
outcome estruturado e devolve `requiresSeparateConsentWorkflow=true`; a
gravação de consentimento continua em seu fluxo próprio e fail-closed.

## Superfícies e autorização

As rotas ficam em `/commercial/operations/*` e usam o store injetável
`crm/api/server/atendimento/commercialOperationsStore.js`, separado do store
legado. Todas exigem a política já existente de Clientes (`GESTOR`) e o store
repete a checagem de papel. Um gestor sem `allowedUnits` declarado recebe 403;
ele nunca ganha leitura global por omissão. ADMIN global continua sujeito à
assinatura de ator da API.

| Rota | Uso | Dados retornados |
| --- | --- | --- |
| `GET /readiness` | Estado da migration e dos ledgers | Sem PII; flags hard-disabled. |
| `GET /wallet` | Carteira paginada e filtros operacionais | IDs de ação, unidade, status, flags e datas; sem identidade, nome, telefone, e-mail ou notas. |
| `GET /team` | Carga, SLA, outcomes agregados, ausências e duração média de estágios | Agregados por responsável; sem cliente. |
| `GET /campaigns` e `/:campaignId` | Coortes congeladas e eventos | Snapshot allowlisted, contagens e referências opacas; sem membros individuais. |
| `GET /customer-360/:identityId?unit=<slug>` | Timeline unit-bound | Projeção allowlisted, IDs de evento opacos e sem context/evidence bruto. |
| `POST/PATCH` de operações | Campanha, outcome, reatribuição, ausência e rebalanceamento | Apenas trabalho interno auditado; nunca contato externo. |

Customer 360 exige unidade explícita inclusive para administrador global. A
identidade precisa ter prova atual de vínculo com a unidade antes da timeline;
sem prova, o retorno é negado. Eventos globais são reduzidos à revisão de
consentimento/decisão autorizada, nunca à evidência bruta da fonte.

## Readiness de migration

A operação só fica pronta quando a migration
`20260807_commercial_operations_v2` está ativa e as relações abaixo estão
presentes:

- `commercial_actions` e seu ledger append-only `commercial_action_events`;
- `commercial_operation_mutations` e `commercial_campaign_events`, ambos com
  bloqueio de `UPDATE`, `DELETE` e `TRUNCATE`;
- `commercial_campaigns`, `commercial_campaign_members` e
  `commercial_owner_absences`.

O readiness verifica os gatilhos herdados do ledger de ações e os gatilhos v2
dos ledgers de mutation/campaign. Falha de schema, role, trigger ou migration
mantém leitura e escrita v2 indisponíveis; não há fallback para tabelas
parcialmente migradas.

Aplique somente por entrypoint allowlisted e destino estrito já existente:

```text
npm --prefix crm/api run migrate-commercial-operations -- --dry-run
npm --prefix crm/api run migrate-commercial-operations -- --apply
npm --prefix crm/api run migrate-commercial-operations -- --rollback
```

O executor aceita somente o destino local aprovado. Para staging, a migration
precisa entrar no release target-bound de Atendimento com backup e evidência
de destino. Não passe `DATABASE_URL`, segredo, path, URL, shell, SSH, `eval`
ou comando em variáveis/argumentos. Não existe caminho de produção nesta
tranche.

O rollback é não destrutivo: registra a migration como revertida e preserva
ações, campanhas, memberships e evidências append-only. Para voltar o código,
use o SHA anterior após confirmar que o readiness v2 deixa de ser anunciado;
nunca apague um ledger para “desfazer” uma operação.

## Concorrência, versão e auditoria

Cada mutação requer:

1. `Idempotency-Key` opaca (ou o mesmo `idempotencyKey` no corpo), nunca PII;
2. justificativa sem PII;
3. `expectedRevision` na alteração de ação, campanha, ausência ou plano de
   rebalanceamento.

O backend obtém primeiro um advisory lock HMAC da chave de idempotência, só
então verifica readiness e consulta o ledger. Repetição com o mesmo payload
reproduz a resposta; reutilização da chave com outro fingerprint retorna 409.
As linhas mutáveis são travadas com `FOR UPDATE`; rebalanceamento acrescenta um
lock por escopo de unidade e reconstrói o plano dentro da transação. O ledger
guarda ator HMAC, fingerprint e resposta minimizada, sem chave bruta ou razão
em texto.

Campanhas congelam filtros, segmento/versão, corte, coorte, unidade,
responsável, oferta, janela e control group. O control group é determinístico
por hash do contexto e só pode conter membros elegíveis; nenhum membro em
revisão, stale ou bloqueado é promovido a holdout. Mudanças de contexto são
recusadas; somente o ciclo de vida da campanha muda com versão otimista. Uma
coorte semanticamente idêntica é deduplicada sob lock de unidade/contexto.

## Fontes e freshness

Elegibilidade e Customer 360 leem somente checkpoints de fonte já validados.
As fontes obrigatórias vêm do catálogo versionado de Clientes, incluindo
Atendimento, cadastro, vendas, opt-outs Harmonia, bloqueios de permissão e o
grafo de identidade. Cada uma precisa de último estado `complete`, snapshot
completo comprovado, nenhuma reconciliação pendente e validação de até 48 h.
Ausência, parcial, inválida, dead ou stale torna a condição `sourceStale=true`;
nunca há promoção por falta de dado. Fontes opcionais continuam visíveis na
operação de fontes, mas não transformam ausência em exclusão de cliente.

## Verificação antes de revisão

Em um worktree com dependências já disponíveis, execute os testes focais:

```text
node --test --test-concurrency=1 \
  server/atendimento/__tests__/commercialOperations.test.js \
  server/atendimento/__tests__/commercialOperationsMigration.test.js \
  server/atendimento/__tests__/commercialOperationsStore.test.js \
  server/atendimento/__tests__/routes.test.js
```

Também confirme:

- `git diff --check` sem saída;
- nenhum endpoint v2 contém provider, `Harmonia`, dispatch, webhook, shell ou
  gravação de `commercial_contact_permissions`;
- readiness saudável e readiness falho quando um trigger/registro de migration
  faltar;
- repetição, conflito de fingerprint, escopo de unidade vazio, revisão
  otimista e rebalanceamento concorrente por fixtures sintéticas;
- o retorno de carteira, equipe, campanha e timeline não contém telefone,
  e-mail, nome de cliente, nota, `context` ou `evidence` bruto.

CI deve executar a suíte completa da API com a árvore de dependências do
release. Este runbook não substitui smoke autenticado de staging nem autoriza
produção.
