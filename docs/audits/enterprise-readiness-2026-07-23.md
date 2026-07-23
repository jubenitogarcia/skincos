# SKINCOS — auditoria executiva de prontidão empresarial

**Data da auditoria:** 2026-07-23  
**Estado:** não certificado para nova liberação empresarial. Nenhuma alteração de produção foi feita nesta auditoria.  
**Baseline implantado auditado:** `main` `2151a49d267f39e2ba5c81b4ba741a469d059722`. As correções descritas em “Correções locais” ainda aguardam PR, CI remoto e promoção deliberada.

## Decisão executiva

O SKINCOS tem uma base de contratos e controles locais mais madura: catálogo de
módulos, estágios oficiais, políticas de resiliência, caos controlado,
backup/restore e releases independentes para Finance, Ponto e Atendimento. Isso
**não** é evidência operacional suficiente para habilitar uma nova jornada de
negócio.

Não há módulo novo aprovado para uso empresarial nesta data. Finance, Ponto e
Inventory continuam candidatos ordenados, todos bloqueados por evidência de
staging, monitoramento externo, rollback e restore. Os serviços já expostos em
produção permanecem em operação legada; isso não equivale a uma liberação sob o
novo gate.

## Evidência observada

| Área | Evidência real | Limite da evidência |
| --- | --- | --- |
| Deploy | GitHub Actions verdes em `main` para API/Inventory (`30036467448`), CRM Pages (`30036471519`) e Ponto (`30035173619`); Cloudflare lista versões recentes de API, Inventory e Ponto. | A última execução Core Workers consultada apenas fez smoke porque o SHA já estava em cache; as versões não têm atestação de commit/artefato imutável nem prova de rollback. Finance não existe como Worker remoto na conta consultada. |
| Liveness pública | `api /health`, `insumos /health`, `api/ponto/health` e `orb /healthz` responderam 200. | `api /ready` retornou 404; Finance respondeu 401; `crm /health` devolveu HTML. O contrato health/readiness/version não está implantado de modo uniforme. |
| Degradação | Suíte local controlada: 9/9 cenários; resiliência: 48/48. Inclui Identity, D1, Inventory, Finance, PostgreSQL, fila, WhatsApp, integração e binding Cloudflare. | Não houve injeção de falha em staging nem consumidor de fila implantado. |
| Rollback | Workflows versionados de Finance, Ponto e Atendimento aceitam operação `rollback`. | Não há run/atestado de rollback de staging ou produção para os fluxos principais. |
| Restore | Política 3-2-1, validação do manifesto e workflow de drill existem no repositório. | Nenhuma execução de `backup-restore-drill.yml` está no `main`; cópia offsite e evidência de restore isolado não foram demonstradas. |
| Governança GitHub | Ruleset ativo bloqueia force-push e exclusão e exige checks; environments `staging` e `production` existem. | Repositório é público; ruleset exige zero revisões e os environments não têm aprovador, ambos permitem bypass administrativo. |

## Módulos e decisão de uso

| Situação | Módulos | Decisão |
| --- | --- | --- |
| Prontos para nova liberação | Nenhum | `releasedModules` está vazio. Não habilitar novo módulo nem conceder grupo piloto. |
| Próximo piloto, bloqueado | Finance | Flag padrão desligada e grants existem. Falta Worker/binding de staging, monitor externo, backup offsite, restore isolado, smoke autenticado e rollback ensaiado. |
| Piloto posterior, bloqueado | Workforce/Ponto | Saúde legada está online. Falta CIDR/terminal/PIN de clínica real validado em staging, monitor externo, restore e manutenção/rollback ensaiados. |
| Piloto posterior, bloqueado | Inventory | Falta feature flag própria, smoke de contagem/reconciliação, restore isolado e alerta externo. |
| Em uso legado, sem novo selo | API, CRM, Identity, Booking, Messaging, Orb, Site, Ads, Social, Integrações, Escala e plataformas compartilhadas | Manter somente o comportamento já publicado. Adoção progressiva exige cumprir o estágio oficial do catálogo e a evidência do gate. |

## Arquitetura, dados e isolamento

- O catálogo de módulos, grafo de dependências, validação de fronteiras e
  contratos de eventos estão versionados e passam localmente.
- Identity, Inventory e Finance ainda têm como origem física o D1 compartilhado
  `skincos-db*`; os três D1s separados são plano de coexistência, não recursos
  comprovadamente provisionados. Restaurar Inventory continua com risco de
  tocar dados de Identity até a migração de Identity ser concluída.
- A extração do gateway trata indisponibilidade de Identity para Finance como
  `503 IDENTITY_UNAVAILABLE`; Finance readiness falha sem D1. São controles
  locais validados, ainda não publicados.
- PostgreSQL possui política, pool/timeout e migrations versionadas no
  repositório, mas o readiness agregado do CRM ainda não executa um `SELECT 1`
  limitado em staging/produção.

## Correções locais desta auditoria

Foi removida a capacidade de publicar por oito caminhos concorrentes de código:

- API + Inventory: `deploy-core-workers*.yml`,
  `deploy-workers-reconcile.yml` e `deploy-workers-after-automerge.yml` agora
  falham explicitamente como rotas aposentadas; o caminho canônico é
  `deploy-insumos-worker.yml`.
- CRM Pages: os fluxos `reconcile` e `after-automerge` foram aposentados; o
  caminho canônico é `deploy-crm-pages.yml`.
- Escala e Social Publisher: seus `reconcile` foram aposentados; cada um tem um
  workflow canônico.
- Os caminhos canônicos receberam concorrência serial por unidade/ambiente e
  pins SHA para checkout/setup-node. O manifesto
  `ops/deployment/canonical-pipelines.json` e
  `.github/scripts/validate-canonical-deploy-pipelines.mjs` fazem o CI falhar
  se uma rota aposentada voltar a publicar ou se faltar concorrência.

Esta correção não é deploy: enquanto não entrar em `main`, os caminhos antigos
continuam ativos no GitHub. Ela também não abrange workflows de rotação de
segredos; esses workflows ainda podem criar versões de Worker/Pages fora da
promoção canônica e são a prioridade P0 seguinte.

## Riscos remanescentes e ordem de execução

| Prioridade | Risco e dependência | Mudança ordenada | Aceite objetivo |
| --- | --- | --- | --- |
| P0 | Workflows de sync de segredo ainda alteram Worker/Pages fora do pipeline canônico (`cloudflare-*-sync-*.yml`). | Incorporar cada segredo ao workflow canônico da unidade ou substituí-lo por rotação que apenas prepare o secret para uma promoção canônica; bloquear o fluxo antigo. | Scanner de mutations encontra uma só rota por Worker/Pages; rotação de staging e produção comprovadamente separadas. |
| P0 | Sem restore comprovado, cópia offsite nem rollback real. | Configurar destino offsite distinto, executar drill isolado D1/PostgreSQL/R2/config/estado e rollback de Finance em staging. | Artefatos com checksum, alvo scratch, operador, duração e validação; rollback do mesmo SHA anterior aprovado. |
| P0 | Repo público, sem revisão obrigatória e production sem aprovador. | Migrar para Organization/repo privado; exigir 1 revisão de CODEOWNER e aprovação de environment sem bypass administrativo. | `gh api` mostra privado, ruleset com review/code owner e environments com required reviewer. |
| P1 | Main ainda aciona deploy legado em unidades centrais; não há promoção de artefato imutável nelas. | Converter Core Workers, CRM Pages, Escala e Social para dispatch com SHA atestado, preview → staging → canary → produção. | Produção rejeita SHA sem atestado de staging; o mesmo SHA aparece no deploy e smoke. |
| P1 | Contrato de observabilidade não está homogêneo e monitor primário externo não foi demonstrado. | Publicar health/readiness/dependencies/version sem PII e configurar Uptime Kuma + Prometheus/Grafana fora de GitHub/Cloudflare. | Probe externo recebe alertas com impacto/versão; `ready` responde corretamente para seis unidades. |
| P1 | Cadeia de Actions ainda contém 52 referências por tag. | Pin por SHA cada action restante, começando por deploy, secrets, segurança e backups; validar em CI. | Scanner não aceita tags móveis em workflows privilegiados. |
| P1 | D1 crítico continua compartilhado. | Executar coexistência Identity primeiro, depois Inventory, depois Finance, um domínio por staging release. | Cada domínio tem D1/journal/bucket/permissão próprios e restore de scratch sem tocar pares. |
| P2 | Finance Miniflare completo não conclui localmente; readiness CRM não testa PostgreSQL vivo; outbox não tem consumidor implantado. | Isolar a execução no CI Linux, adicionar probe PostgreSQL com timeout e implantar primeiro consumidor com DLQ/reconciliação em staging. | Testes reproduzíveis e evidência de retry/DLQ sem bloquear produtor. |

## Dependências de fornecedores

| Fornecedor | Papel | Continuidade exigida |
| --- | --- | --- |
| Cloudflare | Workers, Pages, D1, R2, KV, filas, DNS | Backup fora da conta Cloudflare, monitor externo e rollback por versão/artefato. |
| GitHub | código, Actions, approvals e evidência | Não ser monitor primário; Organization privada, environment approvals e actions pinadas. |
| PostgreSQL host | CRM/Orb e domínios extraídos | roles por serviço, dump/WAL offsite e restore em banco scratch. |
| WhatsApp e demais integrações | canais opcionais e workflows | timeout/circuit breaker, DLQ/reconciliação e procedimento manual por domínio. |
| Operador S3-compatible externo | cópia offsite cifrada | teste de acesso/restauração mensal; não compartilhar conta com Cloudflare/PostgreSQL. |

## SLO e recuperação propostos

Os SLOs e RPO/RTO são metas contratuais, não medição corrente: API/Inventory e
Ponto p95 de health/read até 800 ms; Finance/CRM até 1 s; alertar após duas
falhas em dois minutos. D1 crítico tem RPO 24 h (Finance 4 h em piloto) e RTO
4 h; PostgreSQL operacional RPO 1 h/RTO 4 h; R2 RPO 24 h/RTO 8 h. A política
exige 35 diários, 12 semanais e 12 mensais, criptografia `age` e prova de
restore isolado conservada por 24 meses.

## Condição de encerramento

Esta auditoria só pode receber selo final após evidência real, anexada fora do
Git, para os fluxos Finance e Ponto: deploy do mesmo SHA em staging, falha
controlada/degradação, rollback para SHA anterior e restore isolado com
checksum. Até lá, o estado correto é **gate bloqueado**, não “pronto”.
