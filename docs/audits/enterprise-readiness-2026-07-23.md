# Auditoria-base — prontidão empresarial e uso progressivo

**Data:** 2026-07-23
**Fonte de código:** `origin/main` em `2151a49d267f39e2ba5c81b4ba741a469d059722`
**Escopo:** arquitetura, deploy, dados, governança e continuidade; inspeção de repositório e configurações GitHub disponíveis. Não foi realizado deploy, restore, migration ou alteração de produção nesta auditoria.

## Baseline atual

O repositório contém CRM, API, Workers de Inventory e Ponto, domínio de Financeiro, site público, Orb/n8n e integrações. A `main` tinha checks obrigatórios para CI, E2E, JS/TS, auditoria de dependências e Gitleaks; force push e exclusão estavam protegidos. A proteção consultada não exigia revisão de CODEOWNERS e não havia evidência desta auditoria de aprovações de environment para staging/produção.

Os endpoints e contratos de saúde não eram uniformes na verificação anterior: Inventory e Ponto respondiam health, Financeiro exigia autenticação, CRM expunha HTML em `/health` e `/ready` da API não era um contrato disponível. Isso impede um gate operacional único até haver health, readiness, dependências e versão por unidade.

## Achados priorizados

| Prioridade | Achado | Risco | Próxima ação verificável |
| --- | --- | --- | --- |
| P0 | Sem evidência consolidada de restore/rollback por domínio | perda ou indisponibilidade prolongada | política de backup, restore isolado e exercício auditável |
| P0 | Migrations e dados ainda não segregados por domínio crítico | alteração/recuperação cruzada | inventário, owners, journals e plano de coexistência |
| P0 | Publicação/sincronização possui caminhos legados a reconciliar | deploy duplicado ou fora de ordem | um pipeline canônico por unidade/ambiente, com concorrência |
| P1 | Identity ainda possui acoplamentos históricos com Inventory | falha de estoque pode afetar acesso | contrato de ator/escopos e migração compatível |
| P1 | Processos e integrações pesadas compartilham disponibilidade com CRM API | falha em job degrada fluxos não relacionados | extrair workers contínuos e aplicar fila/outbox |
| P1 | Observabilidade e contratos de health heterogêneos | incidente sem impacto/versão claros | health/readiness/dependencies/version e logs padronizados |
| P2 | `staging` ainda requer transição para promoção de artefato | release divergente e difícil de reproduzir | promover o mesmo artefato, sem branch paralela |
| P2 | Governança externa ainda incompleta | alteração sem separação de ambiente | rulesets, environments, secrets segregados e actions pinadas |

## Evidência e limites

- Há evidência de checks e proteção básica de branch; isso não prova deploy de cada serviço nem rollback de artefato.
- Não há nesta baseline evidência real de restore isolado, caos controlado, canary, DLQ/outbox, backup fora do fornecedor ou SLO monitorado externamente.
- Nenhum módulo é promovido por este documento. Estado, piloto e acesso de usuário continuam sujeitos ao catálogo, feature flag e gates operacionais futuros.

## Critério de saída da baseline

A auditoria será substituída por evidência operacional quando cada fluxo crítico possuir: pipeline canônico, artefato/versionamento, health/readiness padronizado, flag e rollback, backup e restore isolado, teste de degradação e registro de aprovação de produção. Até então, as lacunas acima são riscos conhecidos e devem ser tratadas na ordem do plano executivo.
