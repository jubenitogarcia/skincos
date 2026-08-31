# Schedule Public Read — preview e staging

## Escopo desta esteira

`.github/workflows/deploy-schedule-public-read-adapter.yml` é o único
publicador do Worker isolado `skincos-schedule-public-read-staging`. Ele não
publica `skincos-escala-api-staging`, não aplica migration, não escreve em D1,
não adiciona rota/custom domain e não chama Website, Booking ou
BelezaEmMovimento.

O core Schedule continua sob o publicador canônico
`.github/workflows/deploy-escala-api.yml`. Somente esse workflow pode receber
`enable_schedule_public_read=true`, criar uma versão candidata não publicada
do core com as capacidades necessárias e publicar
`skincos-escala-api-staging` com a projeção habilitada. Produção rejeita esse
opt-in e sempre recebe `SCHEDULE_PUBLIC_READ_ENABLED=false`. O adaptador só faz
uma chamada de serviço autenticada à projeção de leitura do core já publicada
em staging.

## Pré-requisitos verificáveis

- A revisão informada é um SHA completo, alcançável de `main`, e tem o preview
  bem-sucedido do próprio adaptador.
- Para `operation=deploy`, existe uma evidência de staging de
  `deploy-escala-api.yml` para a mesma revisão e com o opt-in explícito. A
  esteira baixa e verifica tanto `promotion-evidence-escala-api` quanto
  `schedule-public-read-core-opt-in-evidence` antes de qualquer alteração no
  adaptador. O segundo artefato vincula SHA, run, tentativa 1, core de staging
  e a habilitação da projeção.
- O core de staging já lista o nome
  `SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY`; a nova esteira nunca escreve esse
  segredo no core.
- O ambiente GitHub `staging` fornece os nomes
  `SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY` e
  `SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY`. Os valores normalizados são testados
  como não vazios e diferentes, sem serem impressos ou incluídos em artefatos.
- `ENABLE_SCHEDULE_PUBLIC_READ_STAGING=true` é exigido apenas para ativar o
  candidato. A opção `disable` continua disponível para fechar o adaptador.
- Os dois `wrangler.toml` mantêm
  `SCHEDULE_PUBLIC_READ_ENABLED=false` por padrão, inclusive em staging. A
  única versão com valor `true` é a candidata criada após todos os gates.
- Quando o core é habilitado, o publicador canônico cria uma única versão não
  publicada com `ESCALA_ACTOR_HMAC_KEY` e
  `SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY` por `stdin` em memória; só então a
  promove por tag. Esse caminho também não usa `secret put`.
- A coordenação global usa o recurso
  `deploy:schedule-public-read-adapter:staging` e é revalidada antes de cada
  mutação Cloudflare.

## Preview

O dispatch `target=preview` não publica nada. Ele fixa o SHA, executa os testes
do contrato e o dry-run de Wrangler, e o promotion gate guarda a evidência
`promotion-evidence-schedule-public-read-adapter` para a promoção de staging.

## Staging e smoke sintético

O dispatch `target=staging, operation=deploy` cria uma única versão candidata
não publicada do adaptador, com as duas chaves recebidas exclusivamente por
`stdin` em memória (`--secrets-file /dev/stdin`). Não há `secret put`, arquivo,
log ou artefato contendo valores de chaves. Só depois de uma nova checagem do
lease a versão identificada por tag é promovida a 100% no Worker isolado
`workforce/schedule/public-read.wrangler.toml --env staging`. O smoke
`public-read-staging-smoke.mjs` roda no workers.dev isolado e prova:

A esteira não presume que exista uma versão ou Worker incumbente: a primeira
versão poderá ser criada apenas nesse upload não publicado e não recebe tráfego
até a promoção por tag. Se a plataforma não puder materializar a versão, o
workflow falha antes de qualquer exposição.

- `/health` pronto;
- `/schedule-public-read/v1/readiness` autenticado por chave edge e encaminhado
  ao core;
- a repetição do mesmo nonce retorna `409`;
- uma chamada sem assinatura retorna `401`.

Nenhum pedido cria agendamento, cliente, mensagem ou dado comercial.

## Rollback

Se o deploy do candidato ou o smoke falhar após uma possível mutação, a esteira
revalida o lease, cria uma versão desabilitada com
`SCHEDULE_PUBLIC_READ_ENABLED=false`, revalida o lease novamente e só então a
promove. Em seguida prova que `/health` retorna
`503 SCHEDULE_PUBLIC_READ_UNAVAILABLE`. Esse é o fallback seguro inclusive no
primeiro deploy, quando ainda não há uma versão incumbente a restaurar.

Para interromper posteriormente uma versão saudável de staging, execute o
mesmo workflow com `target=staging` e `operation=disable`, usando um SHA que já
tenha passado pelo preview. A prova esperada é novamente o smoke `disabled`.
Uma futura restauração de versão anterior só pode ser acrescentada com a versão
incumbente atestada e o mesmo lease; não use comandos manuais fora do
publicador canônico.

## Evidência e próximo gate

Uma ativação de staging bem-sucedida gera
`promotion-evidence-schedule-public-read-adapter`. Isso não autoriza Website
ou Booking a usarem o adaptador: o corte requer a validação posterior do
contrato com CRM/Ponto e a decisão explícita do comportamento de indisponibilidade.

Nenhum dispatch foi executado por esta preparação: os artefatos, releases e
estado Cloudflare existentes permanecem inalterados até uma futura promoção
manual atestada.
