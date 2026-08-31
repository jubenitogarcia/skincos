# Schedule Public Read — preview e staging

## Escopo desta esteira

`.github/workflows/deploy-schedule-public-read-adapter.yml` é o único
publicador do Worker isolado `skincos-schedule-public-read-staging`. Ele não
publica `skincos-escala-api-staging`, não escreve em D1, não adiciona
rota/custom domain e não chama Website, Booking ou BelezaEmMovimento. A única
exceção de lifecycle é o bootstrap explícito, desabilitado e restrito a staging
deste próprio Worker: ele cria o Worker e aplica a migration da Durable Object
antes de qualquer uso de `wrangler versions upload`.

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
- Antes de `operation=deploy` ou `operation=disable`, existe um dispatch
  canônico bem-sucedido de `operation=bootstrap-disabled` para o **mesmo SHA**.
  A esteira baixa `schedule-public-read-adapter-bootstrap-evidence`, confere
  workflow, run, tentativa 1, Worker, flag desabilitada e o digest SHA-256 da
  configuração completa. Ela também confirma que o Worker isolado ainda possui
  um deployment. Qualquer alteração em `public-read.wrangler.toml`, inclusive
  uma migration futura de Durable Object, exige outro bootstrap desabilitado;
  não pode chegar silenciosamente a `versions upload`.
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
  como não vazios e diferentes entre si; a chave edge também precisa diferir da
  chave legada `ESCALA_ACTOR_HMAC_KEY`. Nenhum valor é impresso ou incluído em
  artefatos.
- `ENABLE_SCHEDULE_PUBLIC_READ_STAGING=true` é exigido apenas para ativar o
  candidato. A opção `disable` continua disponível para fechar o adaptador.
- O bootstrap não recebe chaves HMAC, não usa `--secrets-file` e fixa
  `SCHEDULE_PUBLIC_READ_ENABLED=false`. Ele é o único caminho não-dry-run que
  usa `wrangler deploy`; um candidato habilitado nunca sai por esse comando.
- Os dois `wrangler.toml` mantêm
  `SCHEDULE_PUBLIC_READ_ENABLED=false` por padrão, inclusive em staging. A
  única versão com valor `true` é a candidata criada após todos os gates.
- Quando o core é habilitado, o publicador canônico cria uma única versão não
  publicada com `ESCALA_ACTOR_HMAC_KEY` e
  `SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY` por `stdin` em memória; só então a
  promove por tag. Cada promoção por versão recebe explicitamente as credenciais
  Cloudflare necessárias. Após a promoção, o core recebe um smoke autenticado;
  se esse smoke ou a geração/upload das evidências falhar, o mesmo lease cria e
  promove uma versão com a projeção desabilitada e prova `503` no endpoint
  interno. Esse caminho também não usa `secret put`.
- A coordenação global usa o recurso
  `deploy:schedule-public-read-adapter:staging` e é revalidada antes de cada
  mutação Cloudflare.

## Preview

O dispatch `target=preview` não publica nada. Ele fixa o SHA, executa os testes
do contrato e o dry-run de Wrangler, e o promotion gate guarda a evidência
`promotion-evidence-schedule-public-read-adapter` para a promoção de staging.

## Bootstrap desabilitado obrigatório

No primeiro uso do Worker — e novamente após qualquer mudança da configuração
do adaptador — execute o dispatch `target=staging,
operation=bootstrap-disabled`. Depois dos gates normais de SHA e preview, ele:

- revalida o lease global;
- usa `wrangler deploy` somente com
  `SCHEDULE_PUBLIC_READ_ENABLED=false`, sem chave HMAC e sem segredo por
  `stdin`;
- cria o Worker isolado e aplica o lifecycle da Durable Object exigido pela
  plataforma;
- prova que `/health` devolve `503 SCHEDULE_PUBLIC_READ_UNAVAILABLE`; e
- publica apenas o artefato de bootstrap, que vincula SHA, run de tentativa 1,
  configuração e flag desabilitada.

Esse bootstrap não cria um candidato habilitado, não usa `versions upload` e
não dá acesso a Website, Booking ou BelezaEmMovimento.

## Staging habilitado e smoke sintético

O dispatch `target=staging, operation=deploy` cria uma única versão candidata
não publicada do adaptador somente depois de verificar a prova de bootstrap
desabilitado para o mesmo SHA e configuração. As duas chaves chegam
exclusivamente por `stdin` em memória (`--secrets-file /dev/stdin`). Não há
`secret put`, arquivo, log ou artefato contendo valores de chaves. A criação do
candidato e qualquer rollback por versão usam `wrangler versions upload`; só
depois de nova checagem do lease a versão identificada por tag é promovida a
100% com `wrangler versions deploy` no Worker isolado
`workforce/schedule/public-read.wrangler.toml --env staging`. O smoke
`public-read-staging-smoke.mjs` roda no workers.dev isolado e prova:

- `/health` pronto;
- `/schedule-public-read/v1/readiness` autenticado por chave edge e encaminhado
  ao core;
- a repetição do mesmo nonce retorna `409`;
- uma chamada sem assinatura retorna `401`.

Nenhum pedido cria agendamento, cliente, mensagem ou dado comercial.

## Rollback

Se o deploy do candidato ou o smoke falhar após uma possível mutação, a esteira
revalida o lease, cria uma versão desabilitada com
`SCHEDULE_PUBLIC_READ_ENABLED=false` por `versions upload`, revalida o lease
novamente e só então a promove. Em seguida prova que `/health` retorna
`503 SCHEDULE_PUBLIC_READ_UNAVAILABLE`. Esse fallback só é alcançável após a
prova de bootstrap; assim, uma migration ou a primeira criação do Worker nunca
é enviada por `versions upload`. Se qualquer revalidação do lease falhar, a
mutação seguinte é bloqueada; não há promoção sem lease válido.

Para interromper posteriormente uma versão saudável de staging, execute o
mesmo workflow com `target=staging` e `operation=disable`, usando o mesmo SHA
que já tenha bootstrap atestado e preview bem-sucedido. A prova esperada é
novamente o smoke `disabled`. Se esse SHA/configuração ainda não tiver prova,
execute primeiro `bootstrap-disabled`, que já deixa o Worker indisponível de
forma segura. Uma futura restauração de versão anterior só pode ser acrescentada
com a versão incumbente atestada e o mesmo lease; não use comandos manuais fora
do publicador canônico.

## Evidência e próximo gate

Uma ativação de staging bem-sucedida gera
`promotion-evidence-schedule-public-read-adapter`. Isso não autoriza Website
ou Booking a usarem o adaptador: o corte requer a validação posterior do
contrato com CRM/Ponto e a decisão explícita do comportamento de indisponibilidade.

Nenhum dispatch foi executado por esta preparação: os artefatos, releases e
estado Cloudflare existentes permanecem inalterados até uma futura promoção
manual atestada.
