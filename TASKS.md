# TASKS

## Controle de Ponto — `codex/admin/workforce-timekeeping-complete`

- [x] Domínio definitivo criado em `workforce/timekeeping` e montado no gateway.
- [x] D1 modelado com migrations reproduzíveis, constraints, índices, snapshots e auditoria imutável.
- [x] Importador JSON com dry-run, checksum, backup local, idempotência, conflitos e rollback validado.
- [x] Identidade canônica, aliases, unidades temporais e adaptação conservadora da Escala.
- [x] Motor diário/mensal, banco de horas, inconsistências, fechamento e reabertura.
- [x] Matriz de permissões, PIN protegido, biometria cifrada, rate limit, replay e idempotência.
- [x] Cliente/tipos centralizados e gestão funcional na aba CRM.
- [x] Testes locais do domínio, gateway, proxy, cliente, D1 e integração HTTP.
- [x] Executar todos os gates finais (lint completo, testes completos e build de produção).
- [ ] Publicar e validar staging com D1/secrets próprios.
- [ ] Promover por workflow oficial e executar smoke produtivo somente leitura.

## External/product follow-up

- [ ] Confirm or reauthorize the `Google Calendar (Skincos)` credential for the exact scopes required by the inactive clinic Orb workflows.
- [ ] Provide `GOOGLE_CALENDAR_ID`, approved test data and a non-production-safe validation window before enabling a workflow that can create a real calendar event or booking.
- [ ] Review and finish the independent Meta Ads publish-journal work in
  `codex/admin/meta-ads-publish-production-audit`; do not mix it into runtime
  cleanup commits.
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
