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

## P1 — custódia de `IDENTITY_PII_KEY`

- [ ] Registrar, fora do repositório, o owner autorizado, a referência de
  escrow e o procedimento de recuperação/rotação dual-key da chave ativa de
  PII de onboarding. A reconciliação somente leitura de 2026-07-30 confirmou
  três payloads de email, três de telefone e um token de convite cifrados no
  D1 produtivo. Não gerar, copiar, substituir ou rotacionar a chave enquanto
  essa evidência e o procedimento de recriptografia/rollback não existirem.
  Isto não reabre o P0 de Insumos nem autoriza deploy.

## Finance — authoritative reconciliation follow-up (2026-07-29)

- [x] Confirm continuous external observability, a controlled human-alert
  recovery, historical Finance rollback/kill-switch/scratch-restore evidence,
  and the merged PR #815 import state machine.
- [x] Promote current `origin/main` `c277032db96ba96484522a19994a66cbb323a46d`
  through the canonical immutable candidate, Finance Worker/UI and CRM Pages
  preview/staging paths. The synthetic authenticated import/UI canary passed in
  run `30500922386` with zero threshold breaches; the workflow restored the
  non-enabled staging baseline and synthetic grant.
- [x] Obtain a fresh provider-separated PostgreSQL ciphertext, verify
  integrity and restore it in isolated scratch. Drill
  `20260729T2255Z-postgresql-fresh` downloaded 90,908,667 bytes from the
  private Google Drive vault, matched the offsite manifest, verified HMAC and
  restored PostgreSQL 16.14 in 55.43 s; plaintext and scratch were destroyed.
  This closes the recovery gate without activating Finance.
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

### P0 — release atual (produção mantida fail-closed)

- [x] Sanear e integrar a PR #894 como
  `4a6d0cfced901c5297f76d141f5f7f1c18ea4a93`; os bloqueios antigos nela
  descritos foram substituídos pelos controles e evidências atuais.
- [x] Integrar a correção da PR #886 em
  `10b2197731d0210cf8fc8cd961f7a787d73bf650`. Esse SHA é somente a base do
  inventário e não é um candidato promovível pela cadeia atual.
- [x] Inventariar integralmente o delta posterior à PR #886 até o `main`
  observado em `0a2117904ba58eb45e1163fb0971c31e6b2a7d1e`: 58 commits,
  30 first-parent e 109 paths líquidos (33 adicionados, 76 modificados, zero
  removidos). A classificação disjunta cobre Ponto, ledgers, Finance,
  compartilhado/multidomínio, Orb/n8n, Livia/native,
  website/Meta/WhatsApp, observabilidade e CRM Local. O manifesto canônico é
  `docs/project-state/ponto-post-886-delta.json`; a alegação anterior de
  “somente um arquivo Finance” e o inventário de 29 paths estão revogados.
- [x] Corrigir a seleção de origem: o release SHA precisa ser exatamente o
  `GITHUB_SHA` do coordenador executado em `refs/heads/main`, além de ser o
  checkout atual e alcançável por `main`. SHA ancestral não é aceito. Se
  `main` avançar entre estágios, a cadeia precisa recomeçar em `preview`.
- [x] Publicar e atestar o baseline privado de Ponto Core pela PR #919/run
  `30512105626`, com source `0f3480dce1a170ac0f862fa392a95456af292a88`.
  Staging ficou em deployment `d88aa85e-a90b-4fd0-b03b-14bf4c6fc248`,
  version `0ee7a2fe-deff-4f37-bcda-c35ad54b68f3`; produção em deployment
  `96aba9e3-fb02-48b4-bc38-ef6a7187328a`, version
  `487f3c03-0159-4914-8d79-470fd1ef209d`. Ambos permanecem route-only, sem
  routes, domains, `workers.dev` ou preview URLs.
- [x] Exigir run, artifact ID/digest, deployment, version, bindings e
  reatestação live exatos desse bootstrap antes da primeira mutação de staging
  e antes da captura do baseline produtivo; drift interrompe a release.
- [x] Restaurar a navegação de CONSULTOR/EMPLOYEE para exatamente Atendimento
  e Ponto, preservando autorização server-side, regressão CI, fixture
  sintética efêmera, teardown run-scoped e auditoria.
- [x] Implementar os controles técnicos fail-closed: afinidade entre versões
  de Timekeeping/Core/Identity/Pages, seleção privada por service binding,
  coorte conjuntiva de identidade/unidade/rede, pilot/canary sem tráfego
  público default, WAF como precondição externa, grants mínimos, checkpoints
  pelo release SHA, migrations aditivas, SLO autenticado, reconciliação de
  filhos, baseline completo antes da primeira mutation do pilot, atestação
  opaca de separação dos roots antes de mutation, credenciais piloto somente
  no runner self-hosted autorizado, interrupção automática, ownership e
  rollback exato nas quatro superfícies.
- [x] Isolar o Ponto Core do binding Finance e publicar o Pages staging
  `ee5ab6dd-4bba-48da-96ea-38fa686f8691` no projeto `skincos-staging`
  (`https://ee5ab6dd.skincos-staging.pages.dev`), mantendo produção separada.
- [x] Manter `ENABLE_CORE_WORKERS_DEPLOY=false` e
  `module-control:timekeeping=maintenance` em produção. O run canônico de
  contenção é `30496220685`; nenhum pilot, canary ou deploy Ponto produtivo foi
  executado nesta retomada.
- [ ] Provisionar `PONTO_PROFILE_DATA_KEY` distinto e separadamente custodiado
  primeiro em `staging`, somente por fonte/processo autorizado. Prover também
  as referências opacas `PONTO_PROFILE_DATA_KEY_CUSTODY_REF` e
  `PONTO_IDEMPOTENCY_KEY_CUSTODY_REF` no environment. Um custodiante de
  segurança deve registrar `PONTO_ROOT_ATTESTATION_KEY_SHARED` somente como
  secret do repositório e `PONTO_ROOT_ATTESTATION_KEY_ID` somente como variable
  do repositório. Não gerar em CI, ler, copiar entre ambientes ou versionar
  nenhum valor secreto.
- [ ] Criar e atestar as duas regras WAF externas e registrar
  `CLOUDFLARE_ZONE_ID`, `PONTO_WAF_RULESET_ID`,
  `PONTO_WAF_HEADER_RULE_ID` e `PONTO_WAF_CONTRACT_RULE_ID` no environment.
- [ ] Executar `preview` e depois `staging` do mesmo `GITHUB_SHA` corrente,
  incluindo checkpoints, migrations, jornada CONSULTOR autenticada,
  `maintenance → active → maintenance`, teardown e drill real de rollback.
- [ ] Somente depois do staging verde, provisionar um
  `PONTO_PROFILE_DATA_KEY` distinto e separadamente custodiado em `production`,
  com referências de cofre próprias e não reutilizadas; obter a designação
  Identity/Workforce da identidade piloto e cadastrar os secrets de login e
  coorte sem inventar vínculo ou expor PII.
- [ ] Prover `PONTO_PILOT_RUNNER_LABELS_JSON`, um runner clínico online/idle e
  `PONTO_CANARY_COHORT_PERCENTAGE`; habilitar as flags produtivas apenas no
  estágio autorizado.
- [ ] Completar pilot, canary, produção, observação pós-release e cleanup
  somente com predecessores, health/version/gateway, SLO e jornada
  autenticada do mesmo SHA. Até lá, a thread e produção permanecem abertas e
  fail-closed.

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
