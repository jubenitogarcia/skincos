# TASKS

## P0 operacional — incidente de acesso a Insumos

- [ ] **P0 — restaurar e estabilizar o acesso por unidade do módulo de Insumos.**
  A correção de fonte foi integrada pela PR #763, com Central E2E e todos os
  checks requeridos verdes. A validação de acesso no ambiente continua pendente
  porque esta fase proíbe deploys. Até a resolução operacional completa, não iniciar
  extrações arquiteturais, piloto Financeiro, transferência para GitHub
  Organization, mudanças de Ponto/Atendimento ou outro módulo. Não fazer deploy
  nem alterar dados, flags, grants ou produção nesta fase.

## Controle de Ponto — `codex/admin/workforce-timekeeping-complete`

- [x] Domínio definitivo criado em `workforce/timekeeping` e montado no gateway.
- [x] D1 modelado com migrations reproduzíveis, constraints, índices, snapshots e auditoria imutável.
- [x] Importador JSON com dry-run, checksum, backup local, idempotência, conflitos e rollback validado.
- [x] Identidade canônica, aliases, unidades temporais e adaptação conservadora da Escala.
- [x] Motor diário/mensal, banco de horas, inconsistências, fechamento e reabertura.
- [x] Matriz de permissões, PIN protegido, biometria cifrada, rate limit, replay e idempotência.
- [x] Cliente/tipos centralizados e gestão funcional na aba CRM.
- [x] Perfil canônico preparado a partir do modelo de Pessoas, com campos privados cifrados, CNPJ por unidade e tela de perfil no Ponto.
- [x] Testes locais do domínio, gateway, proxy, cliente, D1 e integração HTTP.
- [x] Executar todos os gates finais (lint completo, testes completos e build de produção).
- [x] Publicar e validar staging com D1/secrets próprios (workflow `29700256254`).
- [x] Promover por workflow oficial e executar smoke produtivo somente leitura (produção `29700295125`; API `29700339758`; UI `29753110570`).

## External/product follow-up

- [ ] Review draft PR #832 (`codex/admin/ux-ui-infrastructure`) after required
  checks finish; its UX/UI audit infrastructure is local/synthetic only and
  must not be treated as a production UI audit or deployment authorization.
- [ ] Confirm or reauthorize the `Google Calendar (Skincos)` credential for the exact scopes required by the inactive clinic Orb workflows.
- [ ] Provide `GOOGLE_CALENDAR_ID`, approved test data and a non-production-safe validation window before enabling a workflow that can create a real calendar event or booking.
- [x] Reconciliar e versionar o contrato do `Meta Ads – Publish` (workflow,
  fontes dos Code nodes, Token Vault, migrations, preflight e testes) pela PR
  #840; a execução manual 333 concluiu o lote comercial final.
- [ ] **P1 — reconciliar os runs históricos não terminais do journal Meta Ads e
  validar a entrega da notificação WhatsApp.** A auditoria de 2026-07-29 não
  encontrou lock ativo nem pendência no run final `map_f6a59341d6dace99d70f5533`,
  mas encontrou registros antigos em `acquired`/`processing`/`staged` e um
  retorno de erro do nó WhatsApp na execução 333. Antes de alterar qualquer
  registro, mapear os recursos Meta de cada run, decidir compensação ou
  conclusão idempotente e registrar evidência de entrega; não reenviar
  notificação nem apagar journal por suposição.
- [ ] **P1 — promover o source release nativo do Orb até o `main` que contém a
  PR #840.** O serviço ainda executa o release
  `71ec3a8f63bd8fcaa6861ad1487baf6f1e1be59a`, anterior ao contrato canônico.
  O workflow n8n e o Token Vault já estão sincronizados, mas a promoção do
  release inclui superfícies além do Meta Ads e exige checkpoint, validação
  pré-produção e autorização explícita de produção. Após a promoção, repetir o
  preflight a partir do release ativo e registrar o SHA/rollback.
- [ ] Decide whether draft PR #674 should graduate from the optional GitHub
  autonomy-broker experiment; it is isolated and not deployed.

## Done — architecture and runtime program

- [x] Domain roots, gateway boundary, Booking/EF contracts, runtime units and lifecycle launchers were versioned and integrated through reviewed PRs.
- [x] The seven final services were cut over to native Linux source/state/config/log paths; no active process uses DrvFS or a temporary worktree.
- [x] Windows-to-Linux state transfer, checksum validation, private ownership/permissions and restart persistence were proven.
- [x] A full Orb backup was checksum-validated and restored, including PostgreSQL and storage evidence; rollback checkpoint and prior releases remain available.
- [x] Reachable critical/high CodeQL and Semgrep findings in CRM, Website, Orb and Messaging were corrected with regression tests and no broad suppression.
- [x] The single WhatsApp engine was hardened and promoted; local/public authenticated health passed and sessions remained available after restart.
- [x] The CRM HTTP restart/Git mutation path was disabled operationally and removed from code/workflows; GitHub native deploy reconciliation no longer invokes it.
- [x] Retired WhatsApp variants, their launchers, unconsumed UIs, stale docs/templates and scanner-only vendor trees were removed after production proof.
- [x] Canonical code remains `C:\CodexShared\Projetos\skincos`; mutable state and secrets remain outside the shared repository.
- [x] Legacy units, one-time migration launchers, applied workflow patchers and WSL backup timer were retired; daily backup scheduling is Windows-owned and restore-verified.
- [x] Post-cutover Git, runtime, endpoint, scanner, backup, release and sensitive-artifact auditing completed with rollback preserved.
- [x] Native releases were reduced to the active release plus one proven
  rollback; obsolete transfer archives, recovery worktrees and generated local
  dependencies were removed after consumer checks.
- [x] CRM, Booking and WhatsApp state/config received a separate checksum-
  verified backup with real PostgreSQL restores before Windows legacy state was
  retired.
