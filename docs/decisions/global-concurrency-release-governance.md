# Governança global de concorrência e release

**Status:** Fundação das Fases 1–5 implementada; esta hardening final adiciona
fencing de autoridade, recovery fail-closed, gate de merge com rechecagem final,
closure automática e rastreamento transitive de writers. O coordination plane
foi validado em staging no SHA `64993934c371dba5a06381a98056c5f5eabc419d` e a
implantação canônica de produção foi concluída pelo run `31427360586`, com
readback assinado `ready:true`, `protocol:epoch-fence-v1` e `authorityEpoch:1`
em 2026-08-10. Isso prova somente a disponibilidade da autoridade publicada;
as mutações continuam exigindo lease, custody, closure e gates aplicáveis. A
existência do código não é confundida com o estado live.

## Problema

Branches e worktrees isolam desenvolvimento, mas não arbitravam o instante em
que uma thread podia fazer uma mutação compartilhada. A release Ponto estava
corretamente ancorada em um SHA, porém um avanço independente de `main` fazia o
dispatcher abortar antes da próxima mutação. Esse abort preservava o fail-closed,
mas confundia mudança de ponta do repositório com mudança da dependency closure
da release.

O contrato agora separa cinco decisões: a missão pode estar autorizada; a
operação precisa ser tecnicamente elegível; o recurso global precisa ter
ownership temporário; a integração em `main` pertence à autoridade única; e a
release promove uma identidade/artefato imutável. Autorização não concede
ownership instantâneo. A falta temporária do lease é um estado de espera ou
blocker técnico, não uma solicitação de nova autorização.

## Contrato

`ops/governance/global-concurrency-policy.json` define o contrato
`skincos/global-coordination/v1`. A unidade de autoridade é um `lockScope`, não
o nome superficial da ferramenta:

| Recurso | Escopo de conflito | Uso |
| --- | --- | --- |
| `merge:main` | `repository:main` | Serializa integração em `main`. |
| `release:<module>` | `release:<module>` | Serializa a cadeia governada do módulo. |
| `deploy:<surface>:<environment>` | `surface:<surface>:<environment>` | Serializa publicação da superfície. |
| `mutate:<surface>:<environment>` | `surface:<surface>:<environment>` | Nome canônico para qualquer mutação da superfície. |
| `cloudflare:<surface>:<environment>` | o mesmo escopo da publicação | Alias de compatibilidade para mutação Cloudflare. |
| `promotion:<module>:<environment>` | `promotion:<module>:<environment>` | Reserva promoção de artefato. |
| `global:<operation>` | `global:<operation>` | Operações explicitamente incompatíveis. |

Um lease contém `resource`, `missionId`, `holder/session`, `run/workflow`,
`acquiredAt`, `updatedAt`, `heartbeatAt`, `ttlMs`, estado, `leaseId`, intent
digest e fencing token monotônico. O token anterior nunca autoriza uma mutação
depois de expirar, ser liberado ou revogado. Idempotência só reaproveita o lease
quando owner, idempotency key e intent digest são exatamente iguais; liberação e
revogação repetidas da mesma prova também são idempotentes. Expiração é
observada pelo coordenador antes de uma nova aquisição, permitindo recuperação
segura de lease órfão com nova geração.

O núcleo determinístico está em
`ops/governance/global-coordination-core.mjs`; o adaptador local está em
`scripts/codex-global-coordinator.mjs`. O estado local é aceito somente fora do
checkout, com lock de diretório e escrita atômica. Lock ausente, estado
incompatível, nonce repetido, owner divergente, lease expirado ou fencing
incorreto falham fechados.

O cliente remoto comum está em
`scripts/codex-global-coordination-client.mjs`, com o wrapper de prova em
`scripts/codex-global-coordination-lease.mjs`. Ele exige URL HTTPS, custódia
compartilhada para operações e uma custódia administrativa distinta para
revogação; o arquivo de prova também precisa ficar fora do checkout.

O Durable Object Cloudflare é uma única coordination plane nomeada (`global`),
com SQLite serializado e lock scopes lógicos dentro do mesmo estado. Isso é
necessário para arbitrar conflitos entre `merge:main` e `release:<module>`;
`deploy`, `mutate` e o alias `cloudflare` compartilham o mesmo scope de
superfície. A análise de admission cruza merge com release por caminhos: uma
mudança disjunta é compatível, uma interseção aguarda, e closure ausente ou
ambígua falha fechada.

A transição para esse nome único não pode abandonar objetos antigos: a primeira
versão usa `COORDINATION_PLANE_MODE=legacy-drain`, recusa aquisição/admission/
renovação e roteia check/release/revoke para o scope legado. Depois do TTL
máximo, a mesma versão é promovida com `COORDINATION_PLANE_MODE=global`.

O estado persistido também possui `authorityEpoch` monotônico e cada lease novo
carrega `authorityEpoch` e `authorityKeyId`. O endpoint normal aceita somente
a chave ativa ou a chave anterior dentro de sua janela explícita. O endpoint
separado `/v1/recovery` aceita somente a custódia de recovery e uma intenção de
fencing idempotente; o fencing revoga todos os leases ativos antes de avançar o
epoch. Provas antigas não atravessam a recuperação mesmo quando o Worker
restaurado reutiliza o mesmo estado SQLite.

## Autoridade única de integração

Threads podem criar worktrees, testar, commitar, fazer push e deixar uma PR
`READY_TO_MERGE`. A integração passa pelo `skincos-integration-gate` e pela
workflow `global-merge-authority`: o primeiro consulta a admission global e
permanece pending em conflito compatível com espera; a segunda adquire
`merge:main`, revalida base/head/lease e chama a API de merge uma única vez.
Actions `concurrency` é apenas scheduler. A prova remota, o status obrigatório e
a revalidação imediatamente antes da mutação são a autoridade técnica.

O ruleset versionado acrescenta a regra `update`, limita o merge a `squash` e
declara o GitHub Actions integration actor como único bypass técnico do update
rule. O validador rejeita qualquer workflow adicional que contenha uma mutação
de merge ou atualização direta de `main`.

O readback live de 2026-08-10 mostrou o ruleset ativo `main-enterprise-baseline`
(ID `19631459`) com `deletion`, `non_fast_forward`, `pull_request` somente com
`squash` e os checks obrigatórios, mas sem a regra `update` e sem bypass actors.
A aplicação do estado-alvo foi recusada pelo GitHub porque este repositório
pessoal não pode usar a integração GitHub Actions como actor de bypass de
ruleset. Portanto, o estado-alvo versionado não deve ser descrito como estado
live: a integração suportada permanece `global-merge-authority.yml`, com
revalidação de base/head/lease e checks obrigatórios. A janela residual entre a
última leitura REST e o `PUT /merge` só poderá ser considerada fechada pela
plataforma depois que uma organização ou GitHub App/integração compatível for
provisionada e o ruleset completo for reaplicado e lido de volta. O fail-closed
continua sendo a regra; não se adiciona bypass humano.

## Release imutável sem congelar `main`

Uma identidade de release é formada por `sourceCommit`, `sourceTree`,
`dependencyClosureDigest`, a ref/tag determinística protegida e a lista exata de
artefatos/digests/version IDs. O workflow coordenador cria
`skincos/release/<module>/<sourceCommit>` uma vez, aceita apenas o alvo exato e
persiste `release-identity.json` com digest próprio. Essa identidade de origem
não inclui o ID transitório do run e permanece reutilizável entre staging,
pilot, canary e produção. Depois das superfícies produzirem seus IDs reais, o
coordenador gera `release-identity-final.json`: ele vincula Worker version IDs,
Pages deployment IDs, digests, runs e incumbentes de rollback ao digest da
identidade de origem. O build é uma operação anterior; promoção recebe e
verifica o mesmo conjunto de artefatos.

O dispatcher e os child workflows governados consomem a release tag/ref e o
SHA exato; eles não são redespachados a partir da ponta viva de `main`. Os
environments GitHub admitem somente `main` para o emissor raiz e o namespace
de tags imutáveis `skincos/release/ponto/*` para os filhos. A
validação de `main` permanece apenas no coordenador raiz e nos predecessores
que deliberadamente são emissores em `main`. Durante a migração, o dispatcher
conserva `assertMainShaUnchanged` como compatibilidade exportada, mas a decisão
operacional usa closure. Mudança independente em `main` não cancela a release;
uma mudança relevante na closure é detectada antes do próximo dispatch ou
mutação e interrompe a cadeia.

Antes de cada mutação, `authorizeMutation` exige:

1. lease ainda válido e prova de fencing;
2. intent digest e recurso exatos;
3. dependency closure observada novamente;
4. artefatos exatos, quando a operação é release/promotion.

Uma mudança em `main` fora da closure mantém o candidato válido. Uma mudança
dentro da closure interrompe a cadeia antes da próxima mutação. Ausência de
digest observável não é tratada como “sem mudança”.

O validador `.github/scripts/validate-dependency-closures.mjs` percorre imports
locais, actions, scripts chamados por workflows, configurações Wrangler e
`sharedInputs`. Ele produz um digest determinístico da árvore alcançável por
módulo e falha quando encontra uma borda fora da closure declarada. A prova de
drift deixa de depender somente de listas manuais mantidas por um agente.

O dispatcher Ponto busca a ponta atual de `main` antes de cada dispatch e
compara a closure Ponto, mas despacha o workflow filho na identidade imutável.
`assertMainShaUnchanged` permanece exportado para compatibilidade histórica,
mas não é mais a condição que invalida uma release;
`assertPontoDependencyClosureUnchanged` é a guarda aplicada ao caminho real.
O lease do dispatcher cobre somente a chamada de dispatch; o workflow filho
adquire e renova seu próprio recurso de superfície antes da mutação e libera o
lease ao final.

## Cloudflare single-writer

`.github/governance/cloudflare-single-writer-policy.json` é a autoridade
declarativa para Workers, Pages, D1, WAF e R2
governados. Cada superfície tem um workflow de deploy canônico, seus mutadores
de configuração/segredo explicitamente listados e um grupo de coordenação. Um
workflow combinado que toca Pages e Worker usa o grupo composto correspondente;
assim uma pipeline independente não pode publicar a mesma superfície ou alterar
suas credenciais em paralelo.

O verificador
`.github/scripts/validate-cloudflare-single-writer.mjs` falha fechado quando um
workflow com comando mutador Cloudflare não está classificado, não declara a
prova de coordenação ou usa outro recurso que o grupo canônico. O grupo global é
uma compatibilidade conservadora para mutações compostas; ele não substitui os
leases de release, promotion ou deploy existentes e pode ser dividido somente
quando a prova multi-recurso equivalente estiver implementada.

O próprio coordination plane tem uma única autoridade de publicação:
`.github/workflows/deploy-global-coordinator.yml`. O workflow só aceita `main`,
faz checkout do SHA do dispatch e seleciona o ambiente Wrangler explicitamente.
O primeiro bootstrap de produção exige simultaneamente a entrada booleana
explícita, a ausência de endpoint configurado e a prova remota de que não existe
Worker; qualquer outro estado é rejeitado. Depois do bootstrap, o endpoint
determinístico `https://skincos-global-coordinator-production.skincos.workers.dev`
é publicado na variável do repositório e toda atualização exige
`global:global-coordinator-writer`, usando a mesma custódia GitHub dos demais
mutadores. O workflow lê de volta a versão ativa, executa um gate assinado
read-only contra o Worker publicado e conserva a versão incumbent para rollback.

O workflow `recover-global-coordinator.yml` é uma via de disaster recovery
limitada: exige `main`, primeira tentativa, endpoint degradado não ambíguo,
versão registrada com protocolo epoch-fence, confirmação literal e custódia
separada. Ele restaura somente `version_id@100%`, faz readiness readback e
fenceia o novo epoch antes de permitir nova aquisição. Um incumbent histórico
que ainda não suporte epoch-fence fica explicitamente inelegível, em vez de
ser tratado como recovery seguro por suposição.

Na auditoria live de 2026-08-10, `skincos-staging` não tinha Git provider e
`skincos` estava conectado ao GitHub, mas com `deployments_enabled=false`,
`production_deployments_enabled=false` e `preview_deployment_setting=none`.
Logo, GitHub Actions permanece o único writer de publicação e nenhuma alteração
cega de produção foi necessária. Se essas flags forem desconhecidas ou mudarem,
o contrato exige fail-closed antes de nova promoção.

## Adaptadores

- GitHub mantém `concurrency` como scheduler, mas a saída do dispatcher registra
  `resourceKey`/`lockScope`; scheduling sozinho não é prova de autoridade.
  `global-merge-authority.yml` é o caminho de integração assistida em `main`;
  `codex-keep-prs-mergeable.yml` não habilita mais auto-merge sem lease e
  também adquire `merge:main` antes de atualizar branches de PR.
- Cloudflare usa `ops/cloudflare/global-coordinator/index.js`, com uma classe
  SQLite-backed Durable Object global nomeada `global`; os `lockScope` ficam no
  estado para fencing e admission. A requisição exige nonce,
  timestamp, digest e HMAC; revogação exige custódia administrativa separada.
- Codex App e mini-PC podem consumir o mesmo envelope/lease, sem compartilhar
  cookies, tokens ou estado do checkout. O cliente e o CLI são os pontos
  comuns para essa integração; nenhum segredo é persistido no repositório.
  No mini-PC, `scripts/runtime/global-coordination-mini-pc.sh` força o provider
  `mini-pc`, exige owner explícito e mantém provas fora da árvore imutável.

  A custódia de rotina chega ao mini-PC pelo runner confiável
  `skincos-native-custody`, instalado por
  `scripts/runtime/install-native-custody-runner.sh`. O runner aceita somente
  workflows dispatch-only da `main` e possui um único sudoers command para o
  helper atômico de `/etc/skincos/global-coordination/orb-backup.env`; não há
  mais ponte manual GitHub -> WSL para o secret existente.

Os ambientes dedicados `staging` e `production` do Worker usam Durable Object
SQLite, secrets separados e `preview_urls = false`; nenhum deploy automático de
Pages participa dessa autoridade. O smoke remoto de staging comprovou
aquisição, conflito, autorização, drift de closure, renovação e liberação. O
bootstrap de produção não infere estado a partir de staging: ele consulta o
Worker exato do ambiente, e apenas depois do readback assinado publica
`SKINCOS_GLOBAL_COORDINATOR_PRODUCTION_URL`. Falha, ausência de custody,
endpoint divergente ou estado ambíguo continuam fail-closed.

Os workflows GitHub Ponto passam pela mesma prova: o gate reutilizável adquire
o lease, cada job mutador renova e autoriza imediatamente antes da mutação, e
um job `always()` libera a prova depois que os dependentes terminam. O helper
`scripts/codex-global-coordination-workflow.mjs` é o adaptador comum para
GitHub Actions, Codex App e mini-PC; o provider e o owner são explícitos, e a
custódia nunca é gravada no checkout. WAF apply e os caminhos legados de
watchdog/recovery também usam essa autoridade antes da mutação Cloudflare. O
broker de emergência close-only permanece a única pré-condição anterior ao
lease, porque o fail-close não pode ficar impedido por uma disputa de recurso;
as mutações de materialização e rollback continuam sob lease remoto.

O caminho nativo também é técnico: a preparação instala os atestados
`.skincos-global-coordination-<module>.json` junto da release; a promoção do
Orb, a promoção do artefato WhatsApp, a promoção/rollback do gateway MCP, o
backup do Orb, a migration Harmonia, o rollback/instalação de Atendimento e as
rotas Cloudflare dedicadas adquirem, renovam e verificam leases antes das
mutações. O atestado é rejeitado se o SHA, source tree, módulo, material ou
digest não coincidirem. O publicador Windows do backup só inicia a unidade
nativa através do wrapper coordenado; ausência de custody ou closure interrompe
a operação antes da geração do artefato.

A fila `codex-keep-prs-mergeable` dispara a autoridade oficial para PRs
`automerge/enabled` que estejam `clean`. Isso elimina redispatch manual após
atualização/rebase sem relaxar a ruleset: a autoridade ainda é a única
mutação de `main` e pode permanecer bloqueada por checks ou por drift real.

## Validação e rollout

Os contratos são exercitados por
`scripts/tests/codex-global-coordination.test.mjs` e
`scripts/tests/codex-global-coordination-client.test.mjs`,
`scripts/tests/codex-global-coordination-workflow.test.mjs`, além de
`ops/cloudflare/global-coordinator/index.test.mjs` e dos testes focados do
dispatcher Ponto, do manifesto final de artefatos, da identidade de release,
do gate de environment, da atestação JIT, do matcher de dispatch, do lease do
orquestrador e da reconciliação de children. As fases iniciais incluem
propriedades de exclusividade, fencing após expiração, admission por closure,
retries idempotentes, alias de superfície, indisponibilidade ambígua
fail-closed e rejeição de ref/tag/SHA divergentes. O teste de
caos/concorrência focal reproduz o incidente original: integração independente
fora da closure é admitida, integração sobreposta é bloqueada e drift de
closure invalida a próxima mutação. Há ainda testes de fencing de epoch, retry
idempotente, recovery guard, identidade de promotion e writer graph transitive.
A validação remota do staging deve comprovar a versão implantada antes de
registrar um incumbent de recovery;
rollback é a restauração de uma versão anterior do Worker ou a remoção
controlada do ambiente staging, sem tocar uma rota de produção. A existência
do código, um build ou um endpoint 200 não constitui prova de autoridade global
em produção.
