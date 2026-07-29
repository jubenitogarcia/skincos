# TASKS

## P0 operacional — incidente de acesso a Insumos

- [x] **P0 — restaurar e estabilizar o acesso por unidade do módulo de Insumos.**
  O ciclo foi concluído em `f30f66e70e0dc949adde5120378509a1c95fe557` e
  registrado pela PR #847 (`2f0bba6a`). Staging e produção foram validados com
  identidades sintéticas removidas ao final: unidades canônicas reconciliadas,
  movimentações/overview/insights em 200, sem tempestade de requests e recusa
  fora do escopo preservada como `403/RBAC_UNIT_DENIED`. A regressão autenticada
  de Atendimento também foi aprovada. Débitos de outros módulos seguem
  independentes deste P0.

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
- [x] **P1 — reconciliar as três pendências Meta Ads por lookup Graph somente
  leitura.** Em 2026-07-29 os recursos dos runs
  `map_9c175ce1ed571ccd158ef509`, `map_d4162ea2a7e9660512796dcb` e
  `map_7464107b2ee04e0cab6a27cf` foram comprovadamente `ARCHIVED` e seus jobs
  foram fechados como `rolled_back`, com evento imutável de readback. Não houve
  mutação na Meta; o journal ficou com 110 runs terminais, zero locks ativos e
  zero `reconciliation_required`. A entrega WhatsApp isolada atingiu
  `DELIVERY_ACK`; Telegram permaneceu independente.
- [x] **P1 — promover o source release nativo do Orb até o `main` que contém as
  PRs #840 e #844.** Em 2026-07-29 o ponteiro foi promovido de
  `71ec3a8f63bd8fcaa6861ad1487baf6f1e1be59a` para
  `0c0a4fa0f4c2d0b432d449c0ba154e093b3ffe89` por troca atômica controlada.
  O checkpoint privado, a linhagem e o procedimento de rollback estão em
  `C:\CodexRuntime\operator\admin\skincos\native-promotions\`; preflight do
  Meta Ads Publish, smoke nativo e healths local/público foram aprovados sem
  iniciar execução comercial. O workflow permaneceu inativo/manual na versão
  830. A regra de ACL do preparador foi ampliada e testada para que o preflight
  peer-authenticated consiga ler os 49 Code nodes em releases futuros.
- [x] **P1 — realinhar a release nativa após a integração da PR #854.** O
  release `a32cf1a9034ccd4872cfbde1ae089e56355300c4` foi promovido por troca
  atômica a partir de `0c0a4fa0f4c2d0b432d449c0ba154e093b3ffe89`, com archive,
  lineage, preflight e rollback privados. Orb, proxy, CRM e Booking usam esse
  mesmo SHA; healths local e públicos, audit-live e preflight Meta Ads passaram
  sem iniciar execução comercial.
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
