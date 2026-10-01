# Auditoria-base — prontidão empresarial e uso progressivo

**Data:** 2026-07-23
**Fonte de código:** `origin/main` em `2151a49d267f39e2ba5c81b4ba741a469d059722`
**Escopo:** arquitetura, deploy, dados, governança e continuidade; inspeção de repositório e configurações GitHub disponíveis. Não foi realizado deploy, restore, migration ou alteração de produção nesta auditoria.

## Baseline atual

Este documento é um baseline histórico anterior à separação. Na data da
auditoria o repositório continha CRM, API, Workers de Inventory e Ponto,
domínio de Financeiro, site público, Orb/n8n e integrações. Desde 2026-08-24 o
Orb/n8n é mantido no [repositório independente](https://github.com/jubenitogarcia/orb);
os demais checks e conclusões deste documento permanecem históricos.

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
# Atualizacao autoritativa — 2026-08-01T23:34:16Z

Base atual: `origin/main` `b6a6cc109ff0c0690381612212d9bfc67b84f63b`.
Financeiro permanece `experimental` e desativado; as evidências válidas são
as da cadeia imutável `1a8eeec5...` (staging/canary/rollback/restore), sem
piloto. Insumos P0 permanece resolvido. Ponto teve preview verde
(`30721745126`), mas não staging verde: `30722077457` falhou por checks
ausentes e as tentativas/recuperações seguintes (`30722290342`, `30722510118`,
`30722303882`, `30722308654`, `30722594377`) ficaram fail-closed sem
propagação externa de maintenance observável em 150 s. A tentativa
`30722999071` também foi interrompida antes de mutação porque o mapa público
Ed25519 chegou com BOM; o watchdog `30723359886` confirmou novamente o
fail-close sem propagação externa. Identity continua em
compatibilidade e depende de escrow/owner para corte físico. Não houve
alteração de produção, flags, grants, usuários, secrets ou dados.
