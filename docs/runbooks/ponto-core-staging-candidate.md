# Candidato de staging do Ponto Core

`.github/workflows/ponto-core-staging-candidate.yml` monta o recibo sanitizado
que o publisher isolado do Ponto Pages consome em staging. É somente um
**atestado de artefatos**: possui permissões GitHub `actions: read` e
`contents: read`, baixa evidências imutáveis e não recebe environment GitHub,
credencial Cloudflare, lease de coordenação ou autoridade para mutar Cloudflare.

O publisher canônico de tráfego de Core e Identity é
`.github/workflows/deploy-core-workers.yml`; ele é o único workflow que pode
executar este drill same-artifact. O candidato não cria uma nova versão, não
modifica pesos e não consegue iniciar, recuperar ou repetir um rollback.

## Sequência canônica

Use a sequência normal e governada do Ponto para o SHA completo atual de
`main`; não despache publishers auxiliares nem use um SHA ancestral.

1. O publisher canônico `deploy-timekeeping.yml` publica/atesta a versão de
   Timekeeping de staging para esse SHA.
2. O publisher canônico `deploy-core-workers.yml`, com `release_scope=ponto`,
   `target=staging`, `unit=api` e `same_artifact_rollback_drill=true`, conclui
   primeiro a publicação normal de Core. Só então, ainda em maintenance e sob
   o lease canônico, ele exercita o UUID candidato já publicado contra o seu
   incumbent exato e restaura o mesmo UUID candidato. O artefato resultante é
   `ponto-core-staging-rollback-drill-coreApi-<SHA>`.
3. O mesmo publisher canônico executa Identity com `unit=inventory`,
   `same_artifact_rollback_drill=true` e o
   `core_candidate_version_id` exato do passo anterior. Ele publica Identity
   normalmente, exerce somente seu candidato/incumbent exatos e gera
   `ponto-core-staging-rollback-drill-identityWorkforce-<SHA>`.
4. Somente depois dos três runs canônicos bem-sucedidos (Timekeeping, Core e
   Identity), despache `ponto-core-staging-candidate.yml` em `main`, com o SHA
   exato e os três IDs de run. Não há mais a opção
   `execute_same_artifact_rollback` neste workflow: se qualquer recibo
   canônico estiver ausente ou divergente, ele apenas falha fechado.

Os requisitos habituais do coordenador, da proteção do branch e do ambiente
de staging continuam valendo para os publishers canônicos. O atestador não os
substitui nem concede aprovação de release.

## O que o recibo verifica

O atestador vincula cada artefato ao mesmo repositório, SHA, árvore Git, branch
`main` e primeira tentativa de run. Ele consome somente os recibos de superfície
e mutação dos publishers canônicos e as duas provas de drill acima.

- A prova de Core contém snapshots remotos exatos antes do drill, no incumbent
  e após a restauração, sempre incluindo a identidade/versão de Timekeeping.
- A prova de Identity faz o mesmo e adiciona o snapshot composto final de
  Core, Identity e Timekeeping, além do health de Identity vinculado ao UUID
  candidato.
- As provas exigem maintenance, revalidação do lease canônico antes de cada
  troca de tráfego, candidato/incumbent exatos e restauração ao candidato.
- Core permanece route-only, com o binding de Timekeeping e os metadados de
  versão exigidos; Identity permanece limitado à rota de staging prevista.

### Gate do Worker físico de Timekeeping

Antes de qualquer comando de tráfego, cada drill canônico consulta o Worker
físico configurado `skincos-timekeeping-staging`. O recibo sanitizado de
preflight informa o nome configurado, a versão esperada e se a observação foi
`exact`, `absent` ou `mismatch`; ele é preservado como artefato mesmo quando o
drill falha (`ponto-core-staging-timekeeping-preflight-<surface>-<SHA>`). Um Worker Ponto ativo com outro nome não é substituto implícito:
a ausência ou divergência interrompe o fluxo antes do rollback. A reconciliação
da nomenclatura/ligação no Cloudflare deve ser feita pelo publisher canônico e
atestado novamente antes de uma nova tentativa.

O resultado é o artefato GitHub Actions
`ponto-core-staging-candidate-<SHA>/ponto-core-staging-candidate.json`. Ele
contém apenas identidade de fonte, serviços, UUIDs, tags, exposição, readiness
e referências de recuperação, sem credenciais, PII, dumps ou dados de clientes.

## Limites e recuperação

O trecho de drill em `deploy-core-workers.yml` não faz upload de código,
migration, alteração de secret, rota, Pages ou dados: ele só alterna o tráfego
entre o candidato já publicado e o incumbent exato e restaura o candidato.
A publicação normal anterior continua sujeita às proteções e recibos próprios
do publisher canônico.

Se o drill canônico for interrompido, somente ele pode tentar a recuperação, e
apenas depois de revalidar o lease e confirmar no plano de controle o
incumbent exato que lhe pertence. Qualquer outro estado falha fechado sem nova
mutação. O workflow de candidato não tem caminho de recuperação.

Este recibo não autoriza produção e não substitui o smoke sintético privado do
Ponto Pages. A validação posterior do Pages é quem prova o caminho privado de
Core via service binding e decide se o candidato de staging pode continuar no
fluxo governado.
