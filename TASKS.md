# TASKS

## Snapshot autoritativo de fechamento — `origin/main` `fd91be5ff00dcc311bedc205d3bab9efbae82258` — 2026-08-02T13:46:45Z

Esta seção substitui o snapshot anterior deste ciclo. As correções Ponto
#1039, #1040 e #1042 estão integradas em `origin/main`; o checkout compartilhado
e as alterações não relacionadas não foram tocados.

- **Ponto / SHA:** o SHA avaliado `ae6cab22d7fa4ce5d1a2f38f0d3d5a4315249d23`
  teve preview `30747329164` verde nos quatro surfaces, mas a staging
  `30747573120` parou antes da mutação de Identity/Workforce
  (`30747791111`) por ausência de `ENABLE_PONTO_CORE_WORKERS_DEPLOY` e
  `IDENTITY_BACKUP_PASSPHRASE`. Não há `selected_release_sha` de staging
  completa; o incumbente ativo comprovado é o SHA imutável
  `50872352329446521a84efa44b098f0e3e038497`.
- **Correções / recuperação:** #1039 vinculou o broker de emergência ao KV
  `e69fe06b6abc46eca4f4c00198d078f2` (versão live `6e7c6c22...`, deployment
  `4e4df415...`); #1040 aceitou a custódia agregada validada do watchdog; #1042
  aceitou `emergency-latch-active` como fonte válida de fail-close pós-rollback.
  O recovery `30750613086` passou fresh-close, reconciliação, KV direto,
  restauração do incumbente `30d4f35b-584b-40a7-95ad-d00ca747e057` a 100% e
  prova pós-rollback.
- **Estado live:** health 200 com `ok=false`, `ready=false`, incumbente
  `30d4f35b-584b-40a7-95ad-d00ca747e057` e release SHA
  `50872352329446521a84efa44b098f0e3e038497`; disponibilidade
  `maintenance/emergency-latch-active`; D1, schedule, auth, idempotência,
  criptografia e contexto de rede saudáveis, com `module_control` em
  `MODULE_MAINTENANCE` e `gateway_affinity` em
  `RELEASE_AFFINITY_MISMATCH`. Readiness e release-readiness responderam 503.
  Core API, CRM Pages e a jornada autenticada não foram executados.
- **Financeiro:** permanece `experimental`, `module_enabled=false`, sem
  grants, usuários, coorte ou ativação de produção. Nenhuma mutação de
  produção foi feita.

**Próximo marco externo:** provisionar, por decisão aprovada e sem fallback
entre environments, a flag Ponto de staging e o segredo de backup de Identity;
então executar uma nova cadeia preview→staging e a jornada focal. Não criar ou
copiar secrets, não resetar o latch para fabricar evidência, não habilitar
produção e não avançar Financeiro.

## Snapshot autoritativo de fechamento — `origin/main` `b6a6cc109ff0c0690381612212d9bfc67b84f63b` — 2026-08-01T23:34:16Z

Esta seção substitui qualquer snapshot anterior deste ciclo. As PRs #985,
#990, #994, #997, #998, #999, #1000, #1001, #1002 e #1003 estão integradas;
não há alteração relevante perdida nesta reconciliação.

- **Insumos P0:** resolvido por #847/#848; nenhum sintoma novo observado.
- **Financeiro:** `experimental`, `module_enabled=false`, zero grants reais e
  sem piloto. A cadeia válida continua no SHA imutável `1a8eeec5...` com
  candidata `30673147811`, previews `30673438315`/`30673439481`, staging
  `30673466768`/`30673467862`, canary `30673602091`, abort/kill switch
  `30673708958`, restore scratch e PostgreSQL offsite
  `20260729T2255Z-postgresql-fresh` (55,43 s). Isso não é promoção do SHA
  atual nem autorização de piloto.
- **Ponto:** o SHA candidato explícito `0ebfcfb5...` passou preview
  `30721745126` com Timekeeping, Core Inventory, Core API e CRM Pages. Não
  existe staging verde: `30722077457` falhou antes de mutação porque os
  checks obrigatórios ainda não existiam; `30722290342` e `30722510118` foram
  cancelados pelo fail-close. A tentativa posterior `30722999071` também
  falhou antes de qualquer superfície por rejeitar o mapa público Ed25519
  recebido com BOM (`Ponto capability public verifier map is malformed`). O
  watchdog `30723359886` encerrou fail-closed por não observar a propagação
  externa do overlay em 150 s. Ponto permanece `experimental` e bloqueado.
- **Identity:** permanece em compatibilidade; custódia/escrow de
  `IDENTITY_PII_KEY` e corte físico dependem de owner humano.

**Próximo marco:** obter uma execução staging verde do Ponto no SHA explícito
após corrigir a custódia/configuração do mapa Ed25519 e a propagação externa,
ou registrar o gate humano correspondente. Para Financeiro,
somente a ficha nominal de piloto pode avançar. Produção, flags, grants,
usuários, secrets, dados e Organization continuam proibidos.

## Histórico — reconciliação anterior — `origin/main` `3f3749016b348ed9ce690b7750ad50a6fed7e8b0` — 2026-08-01T00:04:46Z

Este bloco é histórico e preservado somente para auditoria. A `origin/main` da
`3f374901...`, o merge somente documental da PR #976. O baseline de codigo
revalidado antes desse merge foi `3682518e...` apos #974; ele continua sendo
o limite de proveniencia do artefato Finance. O SHA Finance explicitamente
selecionado no inicio da promocao foi `1a8eeec5a188301635603a3ecbd2eb4c8b18368c`
(main em #973), e nenhum commit posterior foi misturado ao artefato Finance.
O checkout compartilhado continua com alteracoes nao relacionadas e nao foi
tocado.

- **Insumos P0:** resolvido por #847/#848; nao ha novo sintoma, escrita ou
  bloqueio operacional relacionado.
- **Financeiro:** permanece `experimental`, com `module_enabled=false`, zero
  grants reais e sem piloto. O SHA selecionado `1a8eeec5...` passou por
  candidata `30673147811`, preview Worker/UI `30673438315`/`30673439481`,
  staging Worker/UI `30673466768`/`30673467862` e canary
  `30673602091`. O canary registrou 22 amostras, p95 192 ms, zero erros,
  falhas de auth/jornada/auditoria/dependencia/divergencia e import idempotente
  com undo. O drill de abort/kill switch `30673708958` falhou somente na etapa
  final intencional de limite excedido e restaurou a baseline desativada.
- **Financeiro em producao:** a fundacao isolada existe e foi promovida pelo
  SHA selecionado em Worker `30673820551` e UI `30673971801`; o binding da API
  e `/finance/health` retornam `1a8eeec5...`. O preflight, health/readiness e
  verificacao D1 passaram; `module_enabled=false`, grants=0 e auditoria=0.
  O flag de deploy foi restaurado para `false`; nenhum usuario/coorte foi
  ativado. Rollback conhecido e o artefato anterior `6acbd485...`.
- **Observabilidade:** monitor externo fora do GitHub/Cloudflare esta ativo
  em modo `operator-run-key` (supervisor e dashboard unicos, loopback, retencao
  30 dias). Alerta e recuperacao controlados foram recebidos via mensagem
  Windows e registrados em `notifications.jsonl`; Event Log segue indisponivel
  na sessao nao elevada e nao e alegado como entregue.
- **Recuperacao:** restore offsite PostgreSQL `20260729T2255Z-postgresql-fresh`
  continua valido (ciphertext verificado, scratch restaurado e destruido,
  55,43 s). Restore scratch Finance/D1/KV e rollback/kill switch permanecem
  evidencias para os artefatos registrados, sem autorizar piloto.
- **Ponto/Identity:** #971 esta integrado, mas Ponto continua sem gates
  externos (WAF least-privilege, runner JIT/attestation, identidade piloto e
  SLO/custodia). Identity continua em modo de compatibilidade; custodia externa
  da chave PII e o corte fisico permanecem bloqueados.

**Proximo marco executavel:** reconciliar e obter aprovacao nominal do pacote
de piloto do Financeiro. Acoes permitidas: atualizar evidencia documental,
smoke sintetico e rollback/kill switch em staging. Acoes proibidas: ativar
`module_enabled`, conceder grants, criar coorte, alterar usuarios/secrets/dados,
promover piloto ou iniciar Ponto/Identity sem seus gates externos.

## Historico — reconciliacao anterior — `origin/main` `d34488afc5b8ea668241382e24f30c745798e033` — 2026-07-31

Esta e a fonte atual para o ciclo. O checkout compartilhado tinha alteracoes
nao relacionadas preservadas fora desta PR em
`C:\CodexRuntime\operator\admin\skincos\reconciliation-20260731`; elas nao
foram misturadas. As PRs #943 e #945 foram integradas em
`16cace3c...` e `d34488af...`, respectivamente, alem de #934/#936/#937/#938/
#939; todos os checks hospedados ficaram verdes e `d34488af...` e o main atual.

- Insumos P0 permanece resolvido por #847/#848; nao ha novo sintoma ou escrita
  nesta reconciliacao.
- Financeiro permanece `experimental`, `module_enabled=false`, sem grants de
  usuarios reais e sem piloto/producao. A cadeia completa mais recente validada
  e `ba16cb4a845e8f96032476a3a2828fc1fb22b399` (Worker `30503675254`, UI
  `30503676485`, CRM Pages `30503679551`, canary `30504263595`, smoke de
  identidade `30504380888`). Ela nao e o `origin/main` atual. O Worker
  `30583405735` em `35aa17db...` foi apenas uma execucao de Worker; nao ha
  cadeia correspondente de UI/Pages/canary para `28747bb...`.
- Rollback, kill switch, restore scratch de D1/KV e restore offsite de
  PostgreSQL continuam evidencias validas dos SHAs/artefatos registrados;
  `20260729T2255Z-postgresql-fresh` e PR #908 sao a evidencia offsite atual.
  Isso nao autoriza producao nem piloto.
- O alerta historico `audit returned 503` (run `30168648150`) e um resultado
  superado pelo canary verde de `ba16cb...`; nao ha reproducao atual no
  `28747bb...`. A observabilidade externa nao pode ser chamada de continua: os
  artefatos de alerta/recuperacao permanecem, mas a instalacao atual e somente
  Run key, sem Scheduled Task/processo ativo, e o ultimo health privado e
  `2026-07-30T18:30:37Z`.
- Ponto: #930/#931/#933/#943/#945 estao integradas; o delta posterior em
  #934/#936/#937/#938/#939 e nao-Ponto. #943 estabeleceu a decisao governada
  `single-operator-codex` (sem reviewer humano, sem bypass administrativo,
  main-only, checks obrigatorios, merge canonico, custodia separada e rollback
  automatico). #945 adicionou broker close-only independente com D1
  transacional, nonce atomico, mutex e latch. Brokers staging/production foram
  publicados e atestados sem expor segredos; ainda nao existe SHA selecionado
  nem evidencia nova de staging/producao; WAF, runner, identidade piloto e
  SLO externo permanecem fail-closed.

Proximo marco seguro do Ponto: obter WAF least-privilege, runner JIT/attestation,
identidade piloto Workforce e SLO externo; somente entao selecionar o HEAD
imutavel e executar preview -> staging -> pilot -> canary -> production.
Acoes proibidas: ativar flags ou alterar grants/usuarios/dados antes desses
predecessores.

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

## Workforce Timekeeping — dependency advisory backlog (2026-07-30)

- [ ] Triar as três vulnerabilidades `high` reportadas pelo `npm audit` completo
  durante o alinhamento local das dependências de Timekeeping. Elas já existiam
  antes desta mudança de gateway e não autorizam `npm audit fix --force`.
  A auditoria de 2026-07-30 identificou `wrangler` direto e `miniflare`/`sharp`
  transitivos; o npm oferece `wrangler@4.115.0` sem salto major. Avaliar a
  exposição em produção e regressões antes de atualizar; manter a auditoria
  `--omit=dev` separada da árvore completa e fechar somente com testes do
  módulo.

## Finance — authoritative reconciliation follow-up (2026-07-29)

- [x] Confirm the historical external observability alert/recovery evidence,
  Finance rollback/kill-switch/scratch-restore evidence, and the merged PR
  #815 import state machine. Continuous monitor operation must be revalidated;
  the current private installation has no active task/process.
- [x] Preserve the historical current-main candidate
  `c277032db96ba96484522a19994a66cbb323a46d` evidence and the later complete
  staging chain `ba16cb4a845e8f96032476a3a2828fc1fb22b399` (Worker/UI/Pages,
  canary and identity smoke). Neither is evidence for current `origin/main`
  `a70fe64c87f2c09c96022c0b18b0b05c9d68d979`.
- [ ] Promote the current `origin/main` SHA through candidate, preview and
  staging for Worker, Finance UI and CRM Pages, then repeat the authenticated
  canary before any pilot decision.
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
  descritos foram substituídos pelos controles e evidências atuais. As três
  conversas residuais receberam resposta rastreável para a PR #921 e foram
  resolvidas; a reconsulta GraphQL em 2026-07-30 retornou zero conversas
  abertas.
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
  “somente um arquivo Finance” e o inventário de 29 paths estão revogados. O
  suplemento determinístico da PR #921 cobre seus 85 paths (72 controles
  Ponto, oito ledgers/runbook e cinco proteções locais); com 15 sobreposições,
  a união até `aa9bfa6595b9cb12e7228f67f9606527bb375de2` cobre os 179
  paths líquidos atuais (77 adicionados, 102 modificados, zero removidos).
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
- [x] Implementar na PR #921 a primeira versão dos controles técnicos
  fail-closed: afinidade entre versões
  de Timekeeping/Core/Identity/Pages, seleção privada por service binding,
  coorte conjuntiva de identidade/unidade/rede, pilot/canary sem tráfego
  público default, WAF como precondição externa, grants mínimos, checkpoints
  pelo release SHA, migrations aditivas, SLO autenticado, reconciliação de
  filhos, baseline completo antes da primeira mutation do pilot, atestação
  opaca de separação dos roots antes de mutation, credenciais piloto somente
  no runner self-hosted autorizado, interrupção automática, ownership e
  rollback exato nas quatro superfícies.
- [x] Integrar a PR #921 sobre o `main`
  `0a2117904ba58eb45e1163fb0971c31e6b2a7d1e` como
  `aa9bfa6595b9cb12e7228f67f9606527bb375de2`. Os 19 checks ficaram verdes,
  oito conversas de segurança foram respondidas/resolvidas, seis chaves
  sintéticas versionadas foram removidas, o regex dinâmico foi fechado, os
  três alertas adicionais de least-privilege/injeção ficaram fixed e o
  CodeQL #4519 foi justificadamente classificado como falso positivo. O merge
  integra a primeira versão dos controles, mas ainda não seleciona um
  candidato.
 - [x] Integrar o pacote corretivo P1/P2 da PR #933. O head validado foi
  `f50a5ee418c237b4a311dd095bceac4264b84c65` e o merge em `main` e
  `28747bb5109407856bd3cb700d91f7f3cb981a69`; nenhum candidato de release foi
  selecionado.
  O pacote contém:
  checkout trusted-main e comparação exata antes de consumir leases; leases
  independentes para baseline/SLO; todos os outputs de provenance do baseline;
  mutex físico de CRM Pages; e kill switch imediato com latch persistente,
  reconciliação/cancelamento, reassert `always()` e reset governado que
  permanece em `maintenance`. O pacote ampliado também recusa `run_attempt>1`,
  revalida o coordenador live imediatamente antes de secrets/mutations em todos
  os jobs privilegiados, trata acknowledgements HTTP 202/204 sem body nos
  helpers, serializa os três writers agendados de secrets Pages no mutex físico
  e remove seus dispatches para o publisher aposentado. A rodada final também
  integrou: capability Ed25519 schema v6 por target; preflight live das
  protections; latch writer sem cancelamento; broker close-only; prova de
  intenção/ownership e rollback determinado de Pages; leitura e reattestation
  live do controle regular + emergency latch antes/depois do rollback;
  `emergencyLatchRef` exata na evidência; drift WAF pós-probe; journal de
  watchdog correlacionado; e kill switch manual pelo broker. O freeze atual
  registra 30 arquivos alterados e 730 adições/1.602 remoções no head da PR;
  `commit_sha=48c23ad77b21c685ca470a87a59eb71a0e88c010`, `pr=933` e
  `selected_release_sha=null` porque a revisão e o merge ainda não ocorreram.
 - [x] Integrar na sucessora a proteção one-time do release probe e o teardown
  de sessão do Identity. Pages valida primeiro o HMAC externo;
  `pilot`/`canary` usam contrato v2 vinculado a stage, coordinator run e workflow
  run, enquanto v1 fica restrito ao drill de `staging`. Antes de qualquer login,
  o nonce é consumido por um único `INSERT` com unicidade no D1 existente via
  Ponto Core/Timekeeping; a chave depende de target, release e SHA-256 do nonce,
  portanto replay concorrente/cross-PoP ou com outro body não reabre. Ponto Core
  injeta a afinidade exata da versão Timekeeping. Após receber cookie de login,
  o probe sempre tenta revogar a sessão corrente ou faz logout; só aceita
  teardown quando o cookie stale recebe o `401` canônico em `/auth/me`. Falha ou
  teardown indeterminado mantém o probe fail-closed e preserva o erro primário.
  A validação local e os checks hospedados passaram; broker externo, WAF,
  custodia de chaves, runner e nova evidencia de staging continuam pendentes.
- [ ] Provisionar e atestar separadamente o broker de fechamento externo nos
  environments `ponto-emergency-staging` e `ponto-emergency-production`:
  secret `PONTO_EMERGENCY_CLOSE_BROKER_CREDENTIAL` e variables
  `PONTO_EMERGENCY_CLOSE_BROKER_URL`,
  `PONTO_EMERGENCY_CLOSE_CUSTODY_REF` e
  `PONTO_EMERGENCY_CLOSE_MODE=external-close-only-broker-v1`, com referências
  de custódia distintas. A identidade revisada também precisa estar fixada por
  target em `.github/governance/progressive-release-policy.json` com URL,
  custody ref, `responseKeyId` e chave pública Ed25519 em formato SPKI PEM. O
  request usa HMAC fresco sobre método/URL/target/custódia/key ID/nonce/tempo e
  digest; a resposta precisa trazer atestação Ed25519 fresca sobre o mesmo
  request e o digest do payload. Hoje os quatro campos da policy são `null`
  tanto em staging quanto em produção. Os environments e a variable de modo já
  estão live pelo checkpoint 13, mas URL, custody ref, credential, key ID/SPKI e
  todos os secrets continuam ausentes. Portanto o broker e qualquer controle
  automático dependente dele permanecem fail-closed; staging não pode iniciar
  sem decisão revisada que fixe os dois endpoints/identidades e sem as chaves
  provisionadas por custódia aprovada. Credencial Cloudflare/KV direta nesses
  environments é proibida.
- [ ] Integrar o consumidor e concluir o namespace fail-closed específico de
  Ponto, mantendo qualquer habilitação separadamente autorizada:
  `ENABLE_PONTO_CRM_PAGES_DEPLOY`,
  `ENABLE_PONTO_CRM_PAGES_DEPLOY_STAGING`,
  `PONTO_CLOUDFLARE_PAGES_PROJECT`,
  `PONTO_CLOUDFLARE_PAGES_PROJECT_STAGING`,
  `ENABLE_PONTO_CORE_WORKERS_DEPLOY`,
  `ENABLE_PONTO_TIMEKEEPING_PRODUCTION_DEPLOY`,
  `PONTO_TIMEKEEPING_D1_STAGING_ID`,
  `PONTO_TIMEKEEPING_D1_PRODUCTION_ID`,
  `PONTO_MODULE_CONTROL_STAGING_KV_ID` e
  `PONTO_MODULE_CONTROL_PRODUCTION_KV_ID`. Após checkpoint privado
  `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T074500-14-ponto-resource-variables-before.md`,
  os seis identificadores/nomes imutáveis de KV, Pages e D1 acima e
  `CLOUDFLARE_ZONE_ID` foram criados como sete variables não secretas do
  repositório e lidos de volta individualmente. Eles estavam ausentes antes e
  foram conferidos contra os recursos Cloudflare live; valores ficam apenas no
  checkpoint privado. As quatro flags `ENABLE_PONTO_*` permanecem sem
  autorização de ativação e o código consumidor continua local. Esses IDs não
  selecionam candidato, não desfazem os fences legados, não implantam nem
  habilitam o módulo. Pages geral continua usando `CRM_PAGES_PROJECT` /
  `CRM_PAGES_PROJECT_STAGING` nas definições antigas. A decisão revisável e o
  runbook correspondentes seguem locais e sem efeito operacional antes do
  merge.
- [ ] Revisar e integrar o overlay
  `module-control:timekeeping:emergency-latch`: missing/unreadable/malformed ou
  `latched=true` nega; somente schema v1 explícito `latched=false` abre; o
  workflow de reset é o único writer de false e mantém o controle regular em
  manutenção. Todas as mutations diretas compartilham
  `ponto-surface-mutation`. O watchdog proposto somente poderá escrever true
  antes do mutex e fechar o controle regular depois da reconciliação quando o
  broker policy-bound estiver provisionado e funcionalmente atestado. Hoje não
  há broker endpoint/key, runner clínico nem prova de freeze/recovery externo
  independente; portanto não registrar automatic interruption/rollback como
  pronto ou operacional. GitHub Actions, monitor, fences e recovery externos
  continuam predecessores obrigatórios.
- [x] Conter externamente o replay produtivo e aplicar fences de dispatch em
  staging em
  2026-07-30T06:57:00Z, após
  checkpoint privado
  `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T035009-03-production-replay-containment.md`:
  definir o override production `ENABLE_CRM_PAGES_DEPLOY=false`, remover
  `TIMEKEEPING_D1_PRODUCTION_ID`, preservar
  `ENABLE_CORE_WORKERS_DEPLOY=false`, apontar
  `CLOUDFLARE_PAGES_PROJECT` para o projeto deliberadamente inexistente
  `skincos-ponto-fenced-production-20260730` e preservar o module-control KV.
  Em staging, definir `ENABLE_CORE_WORKERS_DEPLOY=false` e
  `ENABLE_CRM_PAGES_DEPLOY_STAGING=false`, remover
  `TIMEKEEPING_D1_STAGING_ID`, apontar `CLOUDFLARE_PAGES_PROJECT` e
  `CLOUDFLARE_PAGES_PROJECT_STAGING` para
  `skincos-ponto-fenced-staging-20260730` e preservar
  `MODULE_CONTROL_STAGING_KV_ID`. Nenhum Worker, Pages, D1, binding,
  deployment ou estado live foi alterado naquele instante; o recheck de 06:57
  manteve produção em `maintenance`, staging em `active` e o health de Pages em
  HTTP 200. O fechamento canônico posterior de staging está registrado abaixo.
- [ ] Integrar a proteção permanente e manter contidos os child runs produtivos
  legados sem correlação até expirarem.
  Os sete runs Timekeeping production rerunnable identificados são
  `30420024733`, `30132172442`, `30132009676`, `29966286110`, `29959858249`,
  `29757475250` e `29700295125`; o primeiro não contém o guard atual. O CRM
  Pages `30491926800` teve `run_attempt=2`; e a consulta encontrou zero runs
  do coordenador progressivo. O inventário de 30 dias encontrou 835 runs de
  Pages secret sync, 121 de Workers secret sync, 35 Timekeeping, 83 Core, 113
  CRM Pages deploy, sete module-control e um production baseline. O watchdog
  local agora fecha um rerun do coordenador canônico e a suíte cobre a
  invalidação terminal de capability emitida tardiamente. Um child run
  histórico, porém, continua executando sua definição antiga; por isso esses
  runs permanecem contidos pelos fences externos até expirar. Até o pacote
  local verde ser commitado, revisado em PR, validado pelos hosted checks e
  mergeado, manter a contenção acima e não restaurar suas variáveis.
- [x] Isolar o Ponto Core do binding Finance e publicar o Pages staging
  `ee5ab6dd-4bba-48da-96ea-38fa686f8691` no projeto `skincos-staging`
  (`https://ee5ab6dd.skincos-staging.pages.dev`), mantendo produção separada.
- [x] Manter `ENABLE_CORE_WORKERS_DEPLOY=false` e
  `module-control:timekeeping=maintenance` em produção. O run canônico de
  contenção é `30496220685`; nenhum pilot, canary ou deploy Ponto produtivo foi
  executado nesta retomada.
- [x] Fechar também staging pelo workflow canônico de `main`: run
  `30527767707` no SHA
  `aa9bfa6595b9cb12e7228f67f9606527bb375de2`, jobs `90822614084` /
  `90822665436`, concluiu com sucesso. O artifact `8753392021`
  `module-transition-timekeeping-staging-maintenance-30527767707` tem digest
  `sha256:09de66aad85d0df5fec416917becd87a5aa3004542af8a4ed4bf34ef74244612`
  e expira em 2026-10-28. Após checkpoint privado
  `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T084146-06-staging-maintenance-before.json`
  (prior ausente), o KV de staging registrou schema v2 `maintenance` em
  2026-07-30T08:43:14.511Z; edge health ficou `ok=false/ready=false`,
  `source=control`, e `/me` retornou 503. Produção permaneceu em manutenção.
- [x] Reconciliar o live read-only após o merge: `main=aa9bfa6595...`,
  `selected_release_sha=null`, nenhum dos quatro live surfaces está nesse SHA,
  staging e produção estão agora `maintenance`. Os D1 Timekeeping de
  staging e produção journalizam exatamente `0001`–`0008` (8/8, sem migration
  nomeada pendente), mas o Worker Timekeeping live ainda expõe `workers.dev` e
  `/api/ponto/readiness` em produção ainda responde `200/ready=true` durante
  manutenção. Probes dos headers públicos proibidos retornaram 200 e o
  workforce contract retornou 401, não o 403 exigido na borda; portanto o
  enforcement WAF exigido não foi observado. Isso não prova se um objeto custom
  inacessível existe. Há zero piloto produtivo elegível.
- [x] Confirmar a detecção externa da indisponibilidade fail-closed: o Ponto
  Smoke agendado production `30521686413`, em
  2026-07-30T07:04:44Z, falhou como esperado após cinco tentativas; o proxy
  reconheceu target/actor configurados, mas `ready=false` em todas. Isso prova
  que o monitor externo detecta non-readiness, não um SLO produtivo verde. O
  Ponto UI Smoke anterior `30518888970` passou, mas não é jornada autenticada
  nem autorização de uso.
- [x] Conter o smoke UI legado com checkpoint
  `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T072614-11-legacy-ponto-ui-smoke-disable.md`:
  workflow `Ponto UI Smoke (prod)` id `231059578` ficou
  `disabled_manually`, secrets de repositório `PONTO_SMOKE_EMAIL` e
  `PONTO_SMOKE_PASSWORD` foram removidos por nome sem leitura, e a variable
  `ENABLE_PONTO_UI_SMOKE` foi removida. Não havia run em andamento. Isso
  impede o schedule horário de reutilizar a credencial legada, mas a conta
  histórica GESTOR ainda não foi identificada nem revogada e deve ser
  reconciliada separadamente sem adivinhar identidade ou acessar PII.
- [x] Conter também o backend `Ponto Smoke (prod)` legado com checkpoint
  `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T075100-15-legacy-ponto-smoke-disable.md`.
  O workflow id `230950805` ficou `disabled_manually`; o schedule em espera
  `30536124024`, source
  `aa9bfa6595b9cb12e7228f67f9606527bb375de2`, terminou
  `completed/cancelled` em 2026-07-30T10:54:19Z. O `main` atual ainda associa
  esse probe ao environment protegido de produção; a sucessora local remove o
  environment e mantém o probe de health read-only e não autenticado. Reativar
  somente após essa sucessora ser revisada e mergeada. Nenhum secret,
  identidade, flag, deployment ou banco foi alterado.
- [ ] Provisionar `PONTO_PROFILE_DATA_KEY` distinto e separadamente custodiado
  primeiro em `staging`, somente por fonte/processo autorizado. Prover também
  as referências opacas `PONTO_PROFILE_DATA_KEY_CUSTODY_REF` e
  `PONTO_IDEMPOTENCY_KEY_CUSTODY_REF` no environment. Um custodiante de
  segurança deve registrar a mesma versão efetiva de
  `PONTO_ROOT_ATTESTATION_KEY_SHARED` somente nos environments `staging` e
  `production`, nunca como secret do repositório, e
  `PONTO_ROOT_ATTESTATION_KEY_ID` somente como variable não secreta do
  repositório. O custodiante do orquestrador deve provisionar chaves privadas
  Ed25519 distintas `PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY` somente nos
  respectivos environments e publicar apenas os verificadores/key IDs no mapa
  não secreto `PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON`. A intenção
  one-shot de rollback de Pages usa
  `PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY`, também somente no environment
  selecionado e nunca reutilizada pelo orquestrador. Esses inputs estão
  ausentes e nenhuma capability governada ou rollback automático pode emitir
  autoridade sem eles. Não gerar em CI, imprimir, versionar ou transportar
  valores secretos pelo workflow.
- [ ] Inspecionar com o principal de segurança autorizado e atestar as duas
  regras WAF externas, criando/habilitando somente se a inspeção provar
  necessário, e registrar
  `CLOUDFLARE_ZONE_ID`, `PONTO_WAF_RULESET_ID`,
  `PONTO_WAF_HEADER_RULE_ID` e `PONTO_WAF_CONTRACT_RULE_ID` nos escopos
  previstos pelo workflow.
  `CLOUDFLARE_ZONE_ID` já está presente por nome como variable não secreta do
  repositório e teve readback no checkpoint 14; os três IDs das regras continuam
  ausentes e nenhuma regra foi criada ou alterada.
  A listagem Cloudflare da zona mostrou somente rulesets managed; o GET do
  custom entrypoint não foi autorizado. Tanto o browser interno do Codex quanto
  o perfil Chrome existente chegaram somente ao login Cloudflare, sem sessão
  autenticada; nenhuma credencial foi inserida e nenhuma mutação ocorreu. O
  estado das regras continua não comprovado; o workflow com security token após
  o merge deve atestá-lo, sem bypass no Worker. O secret
  `PONTO_WAF_READ_API_TOKEN` deve ser somente do repositório e
  `PONTO_WAF_WRITE_API_TOKEN` somente do environment `production`; ambos estão
  não provisionados e não podem usar `CLOUDFLARE_SECURITY_API_TOKEN` como
  fallback.
- [x] Endurecer `staging` e `production` após checkpoint
  `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T073000-12-environment-protection-before.md`.
  Staging agora usa required-reviewers rule `61302994` e custom branch policy
  `56015291`; production usa `61303000` e `56015293`. Ambos têm
  `can_admins_bypass=false`, `prevent_self_review=true`, zero wait, apenas
  branch `main` e reviewer único owner `jubenitogarcia` (`199169872`).
  Isso bloqueia o próprio owner atual e reruns históricos, mas não cria reviewer
  independente nem aprovação válida de release. O inventário do repositório
  contém somente esse collaborator owner; o `GITHUB_TOKEN` observado tem
  `can_approve_pull_request_reviews=false`, e nenhum GitHub App/bot/automation
  autorizado a aprovar foi comprovado. Codex não deve fabricar aprovação nem
  contornar a separação de responsabilidade.
- [x] Criar os environments fail-closed `ponto-emergency-staging` e
  `ponto-emergency-production` após checkpoint
  `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T073300-13-emergency-environments-before.md`.
  Eles aceitam somente protected branches, têm `can_admins_bypass=false`, zero
  reviewer/timer/custom rule e branch-policy rule IDs `61303367` /
  `61303369`. GitHub retornou 422 apenas ao tentar
  `prevent_self_review=false` sem reviewer; o readback confirmou a base segura.
  Ambos têm zero secrets e somente a variable
  `PONTO_EMERGENCY_CLOSE_MODE=external-close-only-broker-v1`; URL, custody ref e
  credential do broker permanecem ausentes, portanto o caminho continua
  bloqueado fail-closed.
- [ ] Designar um required reviewer realmente independente para `staging` e
  `production`. O owner atual não pode self-review e nenhum reviewer
  independente foi comprovado; o único collaborator é o próprio owner, o
  `GITHUB_TOKEN` não pode aprovar reviews e nenhum app/bot autorizado foi
  identificado. Os `required_approvals=0` da PR #921 pertencem à governança de
  código e não substituem deployment/pilot approval.
- [ ] Executar `preview` e depois `staging` do mesmo `GITHUB_SHA` corrente,
  incluindo checkpoints, migrations, jornada CONSULTOR autenticada,
  `maintenance → active → maintenance`, teardown e drill real de rollback.
- [ ] Somente depois do staging verde, provisionar um
  `PONTO_PROFILE_DATA_KEY` distinto e separadamente custodiado em `production`,
  com referências de cofre próprias e não reutilizadas; obter a designação
  humana válida, separada da aprovação de deployment, de uma identidade
  CONSULTOR/EMPLOYEE já elegível e ativa em Identity/Workforce e cadastrar os
  secrets de login e coorte sem inventar vínculo ou expor PII. Hoje não há
  identidade elegível/autorizada.
- [ ] Prover `PONTO_PILOT_RUNNER_LABELS_JSON` exclusivamente como repository
  variable (sem homônimo no environment `production`), com os três labels
  automáticos e um label `ponto-jit-*` one-shot; piná-lo a exatamente um runner
  clínico online/idle, ID/nome e supervisor JIT revisados. Prover também
  `PONTO_PILOT_RUNNER_ENCRYPTION_PUBLIC_KEY_PEM` somente como repository
  variable e `PONTO_CANARY_COHORT_PERCENTAGE`; habilitar as flags produtivas
  apenas no estágio autorizado.
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
