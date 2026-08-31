# Roteiro para a extração multi-repositório

**Estado:** decisão de arquitetura em execução
**Data:** 2026-08-28
**Escopo:** após a extração de Orb e BioEvo, ordenar os próximos produtos que
podem deixar o monorepo SKINCOS sem copiar código, runtime ou responsabilidade
de dados.

## Regra de corte

Uma extração só está concluída quando o produto possui repositório privado,
build, testes, publicação e rollback próprios; consome outros produtos apenas
por contrato versionado ou API/service binding; e o código, workflow e
publicador antigos foram removidos do SKINCOS. Espelhos, submódulos, cópias e
dois publicadores para o mesmo Worker não contam como separação.

O produtor continua dono do seu código, runtime, dados, migrations, release e
rollback. Consumidores ficam limitados ao contrato, health/observabilidade e
testes de integração. Este é o padrão já aplicado a Orb.

## O bloqueio comum: Wave 0

Não extrair `shared`, `platform` ou `ops` agora. Eles ainda contêm tanto
contratos neutros quanto infraestrutura/implementação local. Antes de qualquer
corte, concluir estas bases:

1. Publicar contratos neutros como pacotes privados versionados, com exports
    explícitos e SemVer. Os primeiros candidatos são identidade, finance,
    disponibilidade de módulo, observabilidade e adapters de borda. `crm-auth`
    e `identity-runtime` ficam locais até que deixem de reexportar
    implementação. O bootstrap local `skincos-contracts` não deve virar um
    release plane permanente para donos de cadências diferentes: antes da
    primeira publicação, separar contratos de Finance, Identity e Platform ou
    atribuir formalmente um owner neutro, aprovação e calendário de release ao
    pacote compartilhado.
2. Fazer a evidência de promoção identificar repositório, SHA, árvore, digest
   da closure, versão/integridade dos contratos, artefato e predecessor. Um
   predecessor de outro repositório deve usar identidade explícita, nunca a
   suposição de `origin/main` ou `$GITHUB_REPOSITORY` do monorepo.
3. Eliminar as importações diretas sem estado já identificadas e tratar a ponte
   API -> Inventory como compatibilidade stateful. Os Durable Objects legados
   da API não devem ser apagados ou migrados nesta etapa; a regra de negócio da
   fila deve passar para Inventory por service-binding RPC dedicado.
4. Tornar locks e concorrência repo-aware (`merge:<repo>:main` e
   `release:<repo>/<unit>`), mantendo globais apenas os recursos físicos que
   de fato são compartilhados.

## Ordem recomendada

| Onda | Produto privado proposto | Decisão | Motivo e condição de entrada |
| --- | --- | --- | --- |
| P1 | `skincos-meta-ads-reporting` | **Preparar, não cortar ainda** | Há duas implementações divergentes entre `ads/meta/apps/report-ingest-worker` e Orb apontando para o mesmo Worker/D1/R2. Primeiro reconciliar owner, fluxo Orb, contrato HTTP/evento e staging; o novo repositório deve herdar os recursos existentes, não recriá-los. |
| P1 | `skincos-finance` | **Preparar, não cortar ainda** | Worker, D1/KV, migrations e gateway já são próximos de independentes; a UI ainda é compilada pelo CRM e testes ainda tomam runtime/configuração do CRM. Separar UI, testes e pipeline, e registrar um disable/maintenance explícito antes do primeiro rollout. |
| P1 | `skincos-clientes-readonly` | **Preparar, não cortar ainda** | A operação read-only é isolável, mas o entrypoint importa CRM completo e o perfil `full` expõe mais que Clientes. Definir allowlist de leitura e entrypoint próprio, sem rotas comerciais, antes do corte. |
| P2 | `skincos-workforce-schedule` | **Depois da Wave 0** | A API de escala já tem Worker/D1/migrations, porém Website lê o D1 de escala diretamente e Ponto depende do contrato HMAC. Publicar API de leitura de agenda e contrato de ator antes de trocar os consumidores. |
| P2 | `skincos-public-website-booking` | **Depois de Schedule** | `booking/` é só um esqueleto; o booking real (dados pessoais, pedidos, comunicação e tracking) está em `website/`. Extrair Website junto do booking real inicialmente, substituindo a leitura direta da escala por API. |
| P2 | `skincos-whatsapp-adapter` | **Depois da Wave 0; pré-corte protegido** | O release nativo já usa candidato imutável, mas o candidato ainda contém o fork/upstream Evolution. O adapter HTTP do CRM, a custódia e o rollback possuem uma fronteira executável; antes do repositório, substituir a fonte embutida por artefato upstream fixado e manter um único serviço, publicador e rollback. |

## Domínios deliberadamente adiados

`api`, `inventory` e `identity` continuam juntos até haver um plano stateful
para Durable Objects, sessão e dados compartilhados. Também ficam no monorepo
por enquanto: CRM completo, Ponto/timekeeping, EF inteiro, social, backend,
platform, ops, Token Vault e coordenador global. Esses domínios têm contratos,
dados ou release ownership ainda cruzados e seriam falsos positivos de
independência.

## Critérios por corte

Cada PR/repositório de extração deve demonstrar:

1. pacote/contrato publicado e instalação limpa por versão exata;
2. build, testes e artefato do produtor sem path relativo para SKINCOS;
3. dados e migrations com owner único, checkpoint e plano de rollback;
4. preview e staging a partir do mesmo artefato, com health, integração
   sintética e evidência de versão;
5. consumidor migrado ao contrato, sem import, workflow ou publicador antigo;
6. rollback para a versão anterior do novo owner, sem republicar produtos não
   relacionados;
7. remoção verificada da fonte, pipeline e runtime duplicados no SKINCOS.

## Próxima decisão executável

Concluir a Wave 0 em PRs pequenos e independentes. Em seguida, iniciar Meta
Ads Reporting pela reconciliação de ownership (não pela criação do repositório)
e Finance pela remoção da dependência de UI/testes do CRM. O primeiro corte só
começa quando um deles satisfizer todos os critérios acima.

## Evidência de código

- A política de imports e o registro da ponte stateful API -> Inventory estão em
  [`shared/domain-boundaries.json`](../../shared/domain-boundaries.json).
- A fronteira pretendida de cada root está em
  [`target-domain-map.md`](target-domain-map.md).
- O gate atual de promoção fica em
  [`.github/workflows/promotion-gate.yml`](../../.github/workflows/promotion-gate.yml)
  e sua identidade em
  [`.github/scripts/promotion-evidence.mjs`](../../.github/scripts/promotion-evidence.mjs).
