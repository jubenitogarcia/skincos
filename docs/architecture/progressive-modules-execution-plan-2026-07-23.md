# Plano executivo versionado — uso progressivo e continuidade

**Versão:** 1.0 — 2026-07-23
**Baseline:** `origin/main` em `2151a49d267f39e2ba5c81b4ba741a469d059722`
**Estado:** plano de execução; não autoriza deploy, ativação de módulo ou corte de dados.

## Objetivo

Evoluir o SKINCOS para que módulos sejam usados e promovidos progressivamente, falhas permaneçam isoladas, dados e deploys tenham fronteiras próprias e a operação possa continuar de forma degradada e recuperável.

## Ordem de execução

| Ordem | Prioridade | Entrega | Dependência | Critério de aceite |
| --- | --- | --- | --- | --- |
| 1 | P0 | Governança, catálogo e pipeline canônico | baseline desta auditoria | PR curta, gates, flag, owner e rollback exigidos por CI/política |
| 2 | P0 | Segurança de dados e recuperação | inventário de D1, PostgreSQL, R2 e configuração | backups por domínio, restore isolado e evidência auditável |
| 3 | P0 | Identity como domínio | contrato de ator/escopos | sessão compatível, sem dependência de Inventory e rollback validado |
| 4 | P1 | Separação de bancos e migrations | backup e contrato de domínio | D1/PostgreSQL por domínio crítico, migrations aditivas e recovery independente |
| 5 | P1 | Isolamento de processos e eventos | health, outbox e contratos | workers pesados separados; falha do consumidor não bloqueia origem |
| 6 | P1 | Shell CRM e módulos lógicos | registry, flags e error boundaries | Financeiro como padrão; depois Ponto e Atendimento |
| 7 | P2 | Promoção e operação progressiva | artefatos imutáveis, observabilidade e piloto | preview → staging → smoke → canary → produção, com kill switch |
| 8 | P2 | Caos controlado e auditoria final | passos 1–7 com evidência | degradação, rollback e restore comprovados nos fluxos críticos |

## Dependências e riscos principais

- **P0 — dados e autenticação:** a recuperação não pode atravessar domínios; qualquer mudança de sessão, permissão ou migration requer compatibilidade e rollback.
- **P0 — deploy:** caminhos paralelos e ausência de artefato promovido impedem atribuir uma versão a um incidente. Corrigir por unidade operacional, sem consolidar serviços em um único processo.
- **P1 — disponibilidade:** chamadas síncronas entre módulos precisam de timeout, circuit breaker, fallback e indicação de sincronização pendente.
- **P1 — observabilidade:** health, readiness, dependências e versão padronizados devem preceder expansão de piloto.
- **P2 — UX:** o shell permanece responsável apenas por navegação, identidade, permissões, unidade e design system; regras de negócio ficam no módulo.
- **P3 — otimização:** novas extrações só acontecem após métricas e custo/benefício comprovarem a necessidade.

## Gates de maturidade

Experimental → staging → piloto → operacional → crítico. Cada avanço exige owner, catálogo completo, permissões, testes proporcionais, observabilidade, backup, restore, fallback, documentação, flag/kill switch e rollback. Um módulo que não cumpre o gate permanece no estágio anterior, mesmo que o código esteja na `main`.

## Situação de partida

Esta baseline não classifica nenhum módulo novo como liberado por evidência operacional completa. Financeiro, Ponto e Inventory são candidatos a validação progressiva, não aprovações automáticas: faltam, entre outras evidências, contrato uniforme de readiness/dependências, promoção canônica, rollback/restore testados e segregação de dados consolidada. O plano deve preservar funcionalidades existentes e avançar em PRs pequenas, uma fronteira operacional por vez.
