# TASKS

## Resolved P0 — incidente de acesso a Insumos

- [x] **P0 — restaurar e estabilizar o acesso por unidade do módulo de Insumos.**
  O ciclo foi concluído em `f30f66e70e0dc949adde5120378509a1c95fe557` e
  registrado pela PR #847 (`2f0bba6a`). Staging e produção foram validados com
  identidades sintéticas removidas ao final: unidades canônicas reconciliadas,
  movimentações/overview/insights em 200, sem tempestade de requests e recusa
  fora do escopo preservada como `403/RBAC_UNIT_DENIED`. A regressão autenticada
  de Atendimento também foi aprovada. Débitos de outros módulos seguem
  independentes deste P0.

## Finance — authoritative reconciliation follow-up (2026-07-29)

- [x] Confirm continuous external observability, a controlled human-alert
  recovery, historical Finance rollback/kill-switch/scratch-restore evidence,
  and the merged PR #815 import state machine.
- [x] Promote current `origin/main` `c277032db96ba96484522a19994a66cbb323a46d`
  through the canonical immutable candidate, Finance Worker/UI and CRM Pages
  preview/staging paths. The synthetic authenticated import/UI canary passed in
  run `30500922386` with zero threshold breaches; the workflow restored the
  non-enabled staging baseline and synthetic grant.
- [ ] Obtain an authorized streaming/provider path for fresh PostgreSQL
  offsite retrieval, verify integrity, and perform the isolated scratch
  restore. D1/runtime-config evidence does not close this PostgreSQL gate.
- [ ] Keep Finance `experimental`; do not enable the module, change grants or
  start a production pilot until the two preceding gates and named pilot
  approval are recorded.
- [ ] Treat production Finance provisioning as a separate approval: create and
  attest only the isolated Worker, D1, KV, Pages project and environment
  configuration through the canonical path; do not copy staging identifiers.

## Controle de Ponto — liberação atual de Workforce Timekeeping

As marcações abaixo registram a entrega histórica. Elas não comprovam que o
`main` atual tenha a mesma versão no CRM Pages, gateway e Worker, nem que a
jornada autenticada atual continue válida.

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
- [x] Publicar e validar staging com D1/secrets próprios (workflow histórico `29700256254`).
- [x] Promover por workflow oficial e executar smoke produtivo somente leitura (evidência histórica `29700295125`; API `29700339758`; UI `29753110570`).

### P0 — release atual (candidato final ainda não selecionado)

- [x] Integrar o candidato por PR #886 em `main` como
  `10b2197731d0210cf8fc8cd961f7a787d73bf650`, com todos os checks obrigatórios
  verdes. Esta integração não é uma promoção de Worker, gateway ou Pages.
- [x] Inventariar integralmente o delta posterior à PR #886. Entre
  `10b21977…` e `66424871…`, o `main` recebeu: contrato/finalização/convergência
  do canário Finance (PRs #891/#895/#898), guardas produtivas e migration
  aditiva Finance (PR #890), observação e agendamento seguro de releases
  estáveis do Orb/n8n (#888/#896), ACL do
  preparador de release nativo da Livia (#892) e contrato de acessibilidade do
  QA da Livia (#897). O delta total contém 29 arquivos: 17 de Finance, 8 de
  Orb/n8n, 2 do QA da Livia e 2 do preparador nativo, com
  `.github/scripts/validate-deploy-topology.mjs` compartilhado na guarda
  Finance. Nenhum deles altera diretamente o runtime, migration ou workflow
  de Ponto, mas a classificação anterior de “somente um arquivo Finance” era
  incorreta.
- [ ] Selecionar um único SHA imutável somente depois de integrar os controles
  obrigatórios de pilot/canary. O gate canônico aceita SHA ancestral
  alcançável a partir de `main`; portanto `10b21977…` é tecnicamente
  promovível, mas não é mais automaticamente o candidato correto.
- [x] Restaurar a navegação de CONSULTOR/EMPLOYEE para exatamente Atendimento e
  Ponto, preservando a autorização no servidor.
- [x] Cobrir a regressão de navegação e incluir seus arquivos no path filter de
  Timekeeping CI.
- [x] Criar jornada autenticada sintética, com fixture efêmera, teardown
  específico por execução e evidência sanitizada.
- [x] Tornar `PONTO_PROFILE_DATA_KEY` obrigatório nos sync/deploys e registrar
  release SHA/environment no health do Worker.
- [x] Manter `ENABLE_CORE_WORKERS_DEPLOY=true` somente em `staging`.
  `production` voltou a `false` em `2026-07-29T22:17:37Z`, antes de qualquer
  dispatch, e permanece fail-closed até existirem staging, pilot e canary
  válidos.
- [ ] Implementar e validar, antes de produção, afinidade entre versões do Core
  API e Timekeeping, roteamento gradual, coorte piloto baseada em contexto de
  rede, grants mínimos, interrupção automática e evidência externa de SLO. A
  política progressiva atual marca Core Workers, CRM Pages e Timekeeping como
  bloqueados enquanto esses controles não existirem. Corrigir também o default
  fail-open `${ENABLE:-true}` do Core deploy, o checkpoint Timekeeping rotulado
  com o SHA do dispatch em vez do release SHA e a ausência de inputs/gates
  executáveis para pilot/canary.
- [ ] Criar primeiro `PONTO_PROFILE_DATA_KEY` em `staging` por processo de
  segredo aprovado; não gerar/copyar valor pelo código. Somente após staging
  completo e autorização pré-produção separada, provisionar um valor
  independente em `production`.
- [ ] Desacoplar o deploy produtivo do Core API para Ponto do binding Finance
  ausente. O `api/wrangler.toml` atual referencia `skincos-finance`, que não
  existe e já causou Cloudflare `10143`; a correção não pode provisionar nem
  ativar Finance sob este objetivo.
- [ ] Fazer preview e staging do mesmo SHA para Timekeeping, Core API e CRM
  Pages; executar a jornada sintética pelo URL imutável do Pages e confirmar
  que o teardown preservou auditoria.
- [ ] Exercitar `module-control:timekeeping` em staging (`maintenance` →
  `active`) e registrar o rollback; só então tornar `active` explícito em
  produção após promoção imutável, piloto e observação.
- [x] Fechar explicitamente o Ponto produtivo em `maintenance` pelo workflow
  canônico `30496220685`. A contenção/rollback operacional mantém essa chave
  explicitamente em `maintenance`; ela não deve ser removida, pois o estado
  ausente é fail-open. O conjunto incumbente preservado para rollback de
  artefato é Timekeeping deployment
  `0da32d7c-6d6f-4b54-a538-6b7c642e57de`, Core API version
  `a1d6ddb0-905d-4784-9e77-d1231cd75e90` e CRM Pages deployment
  `a77cf500-f272-4d37-87c2-c02f78352c4e`, sempre com a manutenção retida até
  nova atestação. `/api/ponto/me` passou a responder
  `503/MODULE_MAINTENANCE`; a readiness ainda responde 200 e precisa ser
  corrigida para refletir o controle operacional.
- [ ] Corrigir a reconciliação operacional: o inventário agregado encontrou um
  CONSULTOR ativo no Core de staging sem Workforce ativo correspondente; em
  produção não há CONSULTOR ativo elegível para o piloto. Não criar ou ativar
  identidades sem a decisão de Identity/Workforce apropriada.
- [ ] Não considerar produção, piloto, conclusão ou arquivamento provados até
  existirem artefatos, health/version/gateway e jornada autenticada para o
  mesmo SHA.

## External/product follow-up

- [ ] Quando houver um staging Orb isolado e autorização específica, aplicar a
  migration do Music Composition Studio nesse staging, importar o pacote
  unificado ainda inativo e executar jornadas sintéticas. Não usar esta
  pendência opcional como autorização para import, activation, provider pago
  ou migration no `n8n_runtime` de produção.
- [ ] When an unpublished, approved Livia source item is available, run one
  controlled production journey on workflow `WGXr4vYkv9UoJ8zc` version
  `8316de5d-c047-473a-bd6a-662b513b73b5` and verify all destinations externally.
  Do not reuse executions 336/339 media or create synthetic social content.
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
