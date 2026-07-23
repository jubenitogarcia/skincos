# Promoção de artefatos imutáveis

Status: em implantação controlada. Esta decisão substitui `staging` como linha paralela de desenvolvimento. O único ramo de integração é `main`; `staging` é exclusivamente um ambiente de execução.

## Estado reconciliado em 2026-07-23

- O GitHub não possui branch remota `staging`.
- A referência local obsoleta apontava para `0077d2bb`, com 35 commits Finance depois de `95fd912c`; ela não foi mesclada em `main`.
- A linha inteira foi preservada no branch remoto `codex/admin/archive-staging-finance-20260723` e na tag anotada `archive/staging-finance-20260723`.
- `origin/staging` foi podada somente depois da preservação. O worktree histórico ainda em `staging` não deve receber commits novos; qualquer mudança válida deve sair em PRs pequenos a partir de `main`.

## Contrato de release

1. Um candidato é um SHA completo já alcançável por `main`.
2. `prepare-release-candidate.yml` gera `release-source-<sha>`: tarball determinístico, SHA-256 e manifesto. O workflow não publica nada.
3. Cada unidade promove exatamente esse SHA/artefato por `preview`, `staging`, `smoke`, `canary` e `production`; cada fase só pode variar Environment, bindings, segredos, configuração e feature flags.
4. Staging aprova o SHA, nunca um branch. Produção exige a atestação de staging do mesmo SHA; Timekeeping já aplica este padrão e é a primeira unidade de migração.
5. Migrações continuam aditivas e compatíveis. A fase canary usa flag/versão/roteamento reversível; rollback retorna a versão anterior e desliga a flag, sem rollback destrutivo de schema.

## Ordem de migração dos adaptadores

| Ordem | Unidade | Primeiro corte |
| --- | --- | --- |
| P0 | Timekeeping | concluído: checkout e atestação usam `release_sha` alcançável por `main`. |
| P0 | Core Workers | concluído: não tem gatilho por branch e exige SHA/atestado staging para produção. |
| P0 | CRM Pages | remover gatilho de branch `staging`; receber SHA e atestação de staging no workflow canônico. |
| P1 | Escala API | separar a execução atual que altera staging e produção no mesmo run em promoções independentes do mesmo SHA. |
| P1 | Website | produzir build uma vez, promover o mesmo bundle OpenNext e isolá-lo de syncs de segredo. |
| P2 | Social Publisher | adotar promoção SHA quando o módulo estiver explicitamente liberado. |
| P3 | Meta Ads Report | permanece sem publicação até liberação formal; não pode entrar na trilha automática. |

Até o adaptador de uma unidade estar migrado, seu workflow atual é tratado como legado controlado: não se cria branch `staging`, não se mescla o arquivo de archive e não se usa uma mudança do archive como release.
