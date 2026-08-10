# Governança global de concorrência e release

**Status:** contrato implementado; autoridade Cloudflare staging provisionada e
ativada; autoridade de produção permanece ausente e fail-closed

## Problema

Branches e worktrees isolam desenvolvimento, mas não arbitravam o instante em
que uma thread podia fazer uma mutação compartilhada. A release Ponto estava
corretamente ancorada em um SHA, porém um avanço independente de `main` fazia o
dispatcher abortar antes da próxima mutação. Esse abort preservava o fail-closed,
mas confundia mudança de ponta do repositório com mudança da dependency closure
da release.

## Contrato

`ops/governance/global-concurrency-policy.json` define o contrato
`skincos/global-coordination/v1`. A unidade de autoridade é um `lockScope`, não
o nome superficial da ferramenta:

| Recurso | Escopo de conflito | Uso |
| --- | --- | --- |
| `merge:main` | `repository:main` | Serializa integração em `main`. |
| `release:<module>` | `release:<module>` | Serializa a cadeia governada do módulo. |
| `deploy:<surface>:<environment>` | `surface:<surface>:<environment>` | Serializa publicação da superfície. |
| `cloudflare:<surface>:<environment>` | o mesmo escopo da publicação | Impede mutação paralela via caminho Cloudflare. |
| `promotion:<module>:<environment>` | `promotion:<module>:<environment>` | Reserva promoção de artefato. |
| `global:<operation>` | `global:<operation>` | Operações explicitamente incompatíveis. |

Um lease contém owner (`missionId`, `threadId`, `actor`, `provider`), recurso,
intent digest, tempo de expiração, `leaseId` e fencing token monotônico. O
token anterior nunca autoriza uma mutação depois de expirar, ser liberado ou
revogado. Idempotência só reaproveita o lease quando owner, idempotency key e
intent digest são exatamente iguais.

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

## Release imutável sem congelar `main`

Uma identidade de release é formada por `sourceCommit`, `sourceTree`,
`dependencyClosureDigest` e a lista exata de artefatos/digests/version IDs. O
build é uma operação anterior; promoção recebe e verifica a mesma identidade.

Antes de cada mutação, `authorizeMutation` exige:

1. lease ainda válido e prova de fencing;
2. intent digest e recurso exatos;
3. dependency closure observada novamente;
4. artefatos exatos, quando a operação é release/promotion.

Uma mudança em `main` fora da closure mantém o candidato válido. Uma mudança
dentro da closure interrompe a cadeia antes da próxima mutação. Ausência de
digest observável não é tratada como “sem mudança”.

O dispatcher Ponto agora busca a ponta atual de `main` antes de cada dispatch e
compara a closure Ponto. `assertMainShaUnchanged` permanece exportado para
compatibilidade histórica, mas não é mais a condição que invalida uma release;
`assertPontoDependencyClosureUnchanged` é a guarda aplicada ao caminho real.
O lease do dispatcher cobre somente a chamada de dispatch; o workflow filho
adquire e renova seu próprio recurso de superfície antes da mutação e libera o
lease ao final.

## Adaptadores

- GitHub mantém `concurrency` como scheduler, mas a saída do dispatcher registra
  `resourceKey`/`lockScope`; scheduling sozinho não é prova de autoridade.
  `global-merge-authority.yml` é o caminho de integração assistida em `main`;
  `codex-keep-prs-mergeable.yml` não habilita mais auto-merge sem lease e
  também adquire `merge:main` antes de atualizar branches de PR.
- Cloudflare usa `ops/cloudflare/global-coordinator/index.js`, com uma classe
  SQLite-backed Durable Object por `lockScope`. A requisição exige nonce,
  timestamp, digest e HMAC; revogação exige custódia administrativa separada.
- Codex App e mini-PC podem consumir o mesmo envelope/lease, sem compartilhar
  cookies, tokens ou estado do checkout. O cliente e o CLI são os pontos
  comuns para essa integração; nenhum segredo é persistido no repositório.
  No mini-PC, `scripts/runtime/global-coordination-mini-pc.sh` força o provider
  `mini-pc`, exige owner explícito e mantém provas fora da árvore imutável.

O ambiente dedicado `staging` do Worker foi provisionado sem rota de produção,
com Durable Object SQLite, secrets separados e `preview_urls = false`. O smoke
remoto comprovou aquisição, conflito, autorização, drift de closure, renovação
e liberação. `SKINCOS_GLOBAL_COORDINATOR_PRODUCTION_URL` permanece ausente, de
modo que pilot/canary/production falham antes de qualquer mutação. O estado de
produção não é inferido do endpoint staging.

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

## Validação e rollout

Os contratos são exercitados por
`scripts/tests/codex-global-coordination.test.mjs` e
`scripts/tests/codex-global-coordination-client.test.mjs`,
`scripts/tests/codex-global-coordination-workflow.test.mjs`, além de
`ops/cloudflare/global-coordinator/index.test.mjs` e do teste focado do
dispatcher Ponto. A validação remota do staging comprovou a versão implantada;
rollback é a restauração de uma versão anterior do Worker ou a remoção
controlada do ambiente staging, sem tocar uma rota de produção. A existência
do código, um build ou um endpoint 200 não constitui prova de autoridade global
em produção.
