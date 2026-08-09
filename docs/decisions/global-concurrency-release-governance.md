# Governança global de concorrência e release

**Status:** contrato implementado; autoridade remota ainda não provisionada

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

## Adaptadores

- GitHub mantém `concurrency` como scheduler, mas a saída do dispatcher registra
  `resourceKey`/`lockScope`; scheduling sozinho não é prova de autoridade.
- Cloudflare usa `ops/cloudflare/global-coordinator/index.js`, com uma classe
  SQLite-backed Durable Object por `lockScope`. A requisição exige nonce,
  timestamp, digest e HMAC; revogação exige custódia administrativa separada.
- Codex App e mini-PC podem consumir o mesmo envelope/lease, sem compartilhar
  cookies, tokens ou estado do checkout. O cliente e o CLI são os pontos
  comuns para essa integração; nenhum segredo é persistido no repositório.

O Worker não é roteado nem promovido por esta mudança. Sem os secrets,
bindings, route, environment gate, rollback deployment e smoke do próprio
coordenador, ele retorna 503 e não há fallback local que possa ser confundido
com autoridade global. O dispatcher Ponto já aplica a nova dependency closure
antes de cada dispatch; a aquisição remota do lease global fica deliberadamente
como gate de rollout até a custódia remota ser provisionada e os jobs de
recuperação receberem o mesmo ciclo de vida.

## Validação e rollout

Os contratos são exercitados por
`scripts/tests/codex-global-coordination.test.mjs` e
`scripts/tests/codex-global-coordination-client.test.mjs`, além de
`ops/cloudflare/global-coordinator/index.test.mjs`. O próximo gate operacional
é provisionar a autoridade Cloudflare em ambiente dedicado, attestar o
rollback, integrar clientes GitHub/Codex/mini-PC e só então marcar o recurso
remoto como elegível. A existência do código, um build ou um endpoint 200 não
constitui prova de autoridade global em produção.
