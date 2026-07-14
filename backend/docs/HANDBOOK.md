# Backend handbook (consolidado)

Este arquivo consolida documentos de organização do workspace que antes estavam espalhados em vários `.md` dentro de `backend/docs/`.
Algumas referências internas ainda mencionam caminhos/nomes antigos — o conteúdo correspondente foi incorporado aqui.

---

<!-- Source: backend/docs/DECISIONS.md -->

## Decisões do Projeto (skincos)

Data: 2025-12-16

### Decisões tomadas

- **Root oficial do projeto:** `Automation/skincos/` (este é o repositório “de verdade”).
- **Modelo de repo:** monorepo (sem submodules).
- **Configs locais/segredos:** `*.local` ignorado; `*.example` versionado (templates).
- **Dados/estado local:** alvo é `skincos/backend/var/` como raiz única (sempre ignorado).

### Implicações práticas

- Rodar `git`, scripts e `make` sempre a partir de `skincos/`.
- Evitar commits/organização via `Automation/` (superproject legado), para não reintroduzir submodules e ruído.

---

<!-- Source: backend/docs/REPO_LAYOUT.md -->

## Repo layout (backend/frontend)

O monorepo agora usa dois diretórios **canônicos**:

- `backend/` — serviços, automações e agentes (server-side)
- `frontend/` — UIs (browser)

O root do repo foi “limpo” para reduzir duplicações/ruído: use sempre os caminhos canônicos.

Regras práticas:
- Código novo: use sempre `backend/...` e `frontend/...`.
- Scripts: `./backend/scripts/*` é o contrato canônico de execução.
- Catálogo: `backend/capabilities.json` aponta para caminhos canônicos.

---

<!-- Source: backend/docs/INVENTORY.md -->

## Inventário do Workspace (skincos)

Data: 2025-12-16

Este documento é um “mapa rápido” do que existe hoje dentro de `skincos/` (módulos, stacks, entrypoints, portas e pontos de atenção). Referências úteis:
- `backend/docs/MODULES.md` (como rodar)
- `backend/docs/WHATSAPP_MODULES.md` (visão WhatsApp)
- `backend/docs/HANDBOOK.md` (este arquivo: inventário + plano + próximos passos + portas)

### 1) Topo da árvore (principais módulos)

**Core / execução unificada (scripts):**
- `backend/scripts/` — ponto de entrada do workspace (`./backend/scripts/dev.sh`, `./backend/scripts/status.sh`, `./backend/scripts/e2e.sh`)
- `backend/Makefile` — wrappers (`make -C backend dev`, `make -C backend e2e-health`, `make -C backend scraper-*`, etc.)

**Serviços e apps:**
- `frontend/` + `backend/apps/crm-api/` — CRM (Vite + API Express). Portas: `5173` (FE) e `8099` (API).
- `backend/apps/whatsapp/official-module/` — WhatsApp multi-instância (porta base 3001).
- `backend/apps/whatsapp/gateway/` — gateway legado / docker-compose (porta 3001 no compose).
- `backend/apps/actual-server/` — Actual Budget server (porta 5006).
- `backend/apps/whatsapp/chat-module/` — Chat Module (pacotes `@chat-module/*`, opcional).

**Automações / agentes:**
- `integration/ef/` — automação (Python) com `config.local.json` ignorado.
- `backend/apps/automations/sprinta/` — `legacy/` e `v2/` (Python).
- `backend/apps/agent-zero/` — Agent Zero (Python + Node; múltiplas portas conforme README).
- Sales Chart Messenger — automação Python em `backend/apps/automations/sales_chart_messenger/` (runner: `backend/apps/automations/sales_chart_messenger/scripts/run.sh`).

**Instagram:**
- `social/instagram/instagrapi/` — lib + compose (mkdocs em `8000`).
- `social/instagram/module/` — API Node + módulo Python; config local em `social/instagram/module/config/config.local.json` (ignorado).

**Conteúdo histórico / backups:**
- `backend/tools/scripts/xiaomi/` — utilitário (histórico).
- `backend/var/browser-profiles/` — perfis de navegador / dados locais (não-código).
- `archive/` — histórico/legado não-executável (preservado para referência).

### 2) Portas observadas (mais comuns)

Referência completa: `backend/docs/HANDBOOK.md` (seção de portas).

Portas que aparecem como padrão no código/scripts:
- `5173` CRM frontend (Vite)
- `8099` CRM API (Express)
- `3001..3009` WhatsApp instâncias (base + instância)
- `5006` Actual server
- `5000` main app legacy (removido do repo; era apenas legado)
- `6800/6801` Agent Zero integrated (em `backend/apps/agent-zero/integrated/`)
- `8000` mkdocs do `apps/instagram/instagrapi` (via docker-compose)

### 3) Configs locais e segredos (pontos de atenção)

Arquivos sensíveis/locais que existem no workspace (não devem ser commitados):
- `integration/ef/config.local.json` (já ignorado)
- `social/instagram/module/config/config.local.json` (ignorado)
- Vários `.env*` espalhados (`backend/apps/whatsapp/gateway/.env.dev`, `.env.prod`, `sprinta/**/.env`, etc.)

Recomendação: padronizar para **`*.example` no repo** e **`*.local` ignorado**.

### 4) Dados de runtime (precisam migrar para `backend/var/`)

Diretórios hoje dentro do repo que são “estado local”:
- `.wa-sessions/`, `.wwebjs_cache/`, `.wwebjs_auth*`
- `.vite/`, caches
- `node_modules/`, `.venv/`, logs e `.pid`

Recomendação: adotar `skincos/backend/var/` como raiz única de dados (sempre ignorado) e apontar scripts/módulos para lá.

Ferramenta para começar sem quebrar nada:
- `./backend/scripts/migrate-var.sh --dry-run` (ou `--apply`)

### 5) Git/Versionamento (situação atual)

No momento existem **2 níveis de git** no disco:
- `Automation/.git` (superproject antigo, com submodules)
- `Automation/skincos/.git` (repo do monorepo atual)

Para ficar “monorepo de verdade”, é necessário escolher **um** root de versionamento e descomissionar o outro (ver `backend/docs/HANDBOOK.md`).

Decisão tomada: `skincos/` é o root oficial (ver `backend/docs/HANDBOOK.md`).

---

<!-- Source: backend/docs/ORGANIZATION_AUDIT.md -->

## Auditoria e Plano de Organização (skincos)

Data: 2025-12-16

Este documento registra uma varredura do monorepo `skincos/` (estrutura, pesos, riscos e padrões) e propõe um plano incremental para organizar módulos, scripts e dados sem quebrar funcionalidades.

### 1) Inventário (módulos e peso em disco)

Maiores diretórios (aprox.):
- `backend/apps/automations/sprinta/` (varia) — contém automação Sprinta; peso grande costuma ser perfis Chrome/venvs locais (muito peso não-código).
- WhatsApp: `backend/apps/whatsapp/*` (Node) + `backend/libs/whatsapp_integration/` (Python) + `backend/var/whatsapp/*` (sessões/estado local).
- `frontend/` (~555M) — inclui `node_modules/`.
- `backend/apps/actual-server/` (~343M) — inclui `node_modules/` e dados locais.
- `backend/apps/agent-zero/` (~271M) — inclui `node_modules/` e artefatos locais.
- Sales Chart Messenger (~250M, quando presente) — automação Python + runtime local em `backend/var/` (não deve criar `.venv/` dentro do repo).
- `integration/ef/` (histórico) — incluir `.venv/` é anti-pattern; preferir `backend/var/` para estado local.

Observação: a maior parte do peso atual é *artefato local* (venv, node_modules, perfis Chrome, sessões).

### 2) Achados críticos (o que precisa ser tratado primeiro)

#### 2.1 Segurança (credenciais em arquivos)
- Existe arquivo de configuração sensível em `integration/ef/config.json` (contém credenciais). Ele precisa virar configuração local (ex.: `config.local.json`) e as credenciais devem ser rotacionadas/revogadas.
- Há múltiplos `.env` e exemplos espalhados; padronizar: somente `*.example` no repo; arquivos reais sempre ignorados.
- O `social/instagram/module/` também usa arquivo de config JSON (contém contas/opções). Padronizar para `social/instagram/module/config/config.local.json` (ignorado) + `config/templates/modules/instagram-module/config.example.json` (template).

#### 2.2 Repositórios aninhados (`.git` dentro do monorepo)
Foram encontrados vários `.git` internos (ex.: `apps/automations/scraper/.git`, `apps/actual-server/.git`, `apps/automations/sprinta/.../.git` e snapshots históricos).
Isso atrapalha:
- `git status`/diffs (módulos aparecem como untracked ou “repos dentro de repo”).
- padronização de versionamento (não fica claro o que é submódulo vs. código “do monorepo”).

#### 2.3 Dois “roots” de git no disco (Automation vs skincos)
Hoje o workspace existe em dois níveis:
- `Automation/.git` (superproject legado com submodules).
- `Automation/skincos/.git` (onde está o monorepo unificado).

Isso cria ambiguidade de versionamento (o que “vale” para push/backup/CI) e tende a reintroduzir submodules por acidente.
Plano recomendado: escolher **um** root (preferencialmente `skincos/`) e descomissionar o outro de forma controlada (fase 2).

#### 2.4 Artefatos locais versionáveis vs. “lixo de runtime”
Há muitos diretórios “de execução” dentro do repo (ex.: `node_modules/`, `.venv/`, `.chrome-profile*`, `.chrome_profile_*`, `.wwebjs_cache`, `.wa-sessions`, `logs/`, `*.out`, `*.pid`).
Mesmo quando ignorados, eles:
- incham o workspace,
- dificultam backups,
- atrapalham diffs e navegação.

### 3) Estrutura alvo (proposta)

Objetivo: ter um “workspace” claro, onde cada módulo tenha:
- propósito,
- entrypoint,
- dependências,
- portas,
- dados persistentes em um local padronizado (fora do código).

#### 3.1 Organização física sugerida (fase 2, com migração)
Opção recomendada (migrar aos poucos, mantendo wrappers):
- `apps/` (interfaces e apps web)
  - `crm/` (antigo `comprehensive-crm-so/`)
  - `actual/` (atual `actual-server/`)
- `services/` (serviços backend)
  - `whatsapp/gateway/` (atual `whatsapp/gateway/`)
  - `whatsapp-official/` (atual `whatsapp/official-module/`)
  - Sales Chart Messenger (atual: `apps/automations/sales_chart_messenger/`)
  - `apps/instagram/instagrapi/` (atual `apps/instagram/instagrapi/`)
- `agents/`
  - `agent-zero/` (atual `a0/`)
- `apps/automations/`
  - `scraper-espaco-facial/` (atual `apps/automations/scraper/`)
  - `sprinta/` (atual `apps/automations/sprinta/`)
- `archive/` (histórico, profiles, backups não-executáveis)
  - (ex.: perfis de navegador / snapshots históricos)
- `backend/scripts/` (wrappers/entrypoints do workspace)
- `backend/docs/` (documentação)
- `backend/var/` (dados persistentes locais; *sempre* ignorado)

#### 3.2 Organização “lógica” imediata (fase 1, sem mover pastas)
Manter os caminhos atuais, mas:
- centralizar entradas de execução em `backend/scripts/` e `backend/Makefile`;
- declarar “onde estão os dados” por módulo (ex.: `backend/var/actual-server/`, `backend/var/whatsapp/`, etc);
- limpar/ignorar artefatos locais.

### 4) Plano de ação incremental (recomendado)

Status atual (monorepo escolhido):
- `.git` internos removidos (há somente `skincos/.git`).
- `skincos/.gitmodules` removido (sem submodules).
- Config sensível do Scraper migrada para `integration/ef/config.local.json` (ignorado) e criado template em `backend/config/templates/modules/scraper/config.example.json`.

#### Fase 0 — Congelar e proteger (1–2h)
1. Criar `backend/docs/MODULES.md` com catálogo de módulos (propósito, como rodar, portas, envs).
2. Remover do repo qualquer arquivo com credencial (mover para `.local` e ignorar) e rotacionar chaves.
3. Atualizar `.gitignore` para cobrir padrões de runtime e reduzir “ruído” no `git status`.

#### Fase 1 — Higiene do workspace (meio dia)
1. Remover (no disco) artefatos regeneráveis: `node_modules/`, `.venv/`, perfis Chrome “step”, caches, logs antigos.
2. Definir `backend/var/` como raiz única de dados persistentes locais (sessions, sqlite, uploads, etc).
3. Atualizar scripts para apontar para `backend/var/` (via `VAR_DIR`, sem depender de paths absolutos).

#### Fase 2 — Estratégia de git (1 dia)
Escolher um caminho:
- **Monorepo real**: remover `.git` internos e versionar apenas código (sem artefatos).
- **Superproject com submodules**: recriar submódulos (a0, whatsapp-gateway, etc) e manter o superproject leve.

Decisão adicional (importante no seu workspace atual): **qual é o root de git “oficial”**?
- **Opção A (recomendada): `skincos/` é o monorepo oficial**
  - Trabalhar/rodar versionamento sempre a partir de `Automation/skincos/`.
  - `Automation/` vira apenas “pasta container” (n8n, insumos, etc.) ou é migrada para dentro do monorepo.
  - Ações: documentar isso e parar de usar o superproject legado para commits.
- **Opção B: `Automation/` vira o monorepo oficial**
  - Transformar `skincos/` em pasta normal (remover `skincos/.git`) e trazer o conteúdo para o git root.
  - Ações: desativar/retirar submodules legados e normalizar `.gitignore` no root.

**Decisão tomada:** Opção A — `skincos/` é o monorepo oficial (ver `backend/docs/HANDBOOK.md`).

#### Fase 3 — Reorganização física (1–2 dias)
1. Migrar pastas para `apps/`, `services/`, `agents/`, `apps/automations/`, `archive/`.
2. Manter compatibilidade via wrappers em `backend/scripts/` (para não quebrar comandos antigos).
3. Atualizar docs e `backend/Makefile` conforme a nova árvore.

### 6) Plano detalhado (checklist, sem quebrar nada)

#### 6.1 Fase 1 (higiene) — resultado esperado
- `git status` com pouco ruído (sem artefatos e sem configs locais aparecendo).
- Todo estado local indo para `backend/var/` (sessões WhatsApp, perfis Chrome, logs, pids, downloads).
- `backend/scripts/` e `backend/Makefile` continuam sendo o “contrato” para rodar tudo.

Checklist:
1. Criar `backend/var/` e mover (ou apontar) diretórios de estado:
   - WhatsApp: `.wa-sessions/`, `.wwebjs_cache/`, `.wwebjs_auth*`
   - Sprinta: perfis Chrome e logs
   - Instagram: `sessions/`, `downloads/`, `logs/`
2. Ajustar scripts para respeitar `VAR_DIR` (ex.: `VAR_DIR=./backend/var ./backend/scripts/dev.sh restart`).
3. Rodar limpeza com segurança: `./backend/scripts/clean-local-artifacts.sh --dry-run` e só depois `--apply`.

#### 6.2 Fase 2 (git root) — resultado esperado
- Existe **um** lugar claro para “comitar o projeto completo”.
- Sem submodules “fantasmas” e sem repos aninhados.

Checklist (dependendo da opção escolhida em 5.3):
- Opção A (`skincos` oficial): documentar e congelar o superproject legado (sem commits).
- Opção B (`Automation` oficial): trazer `skincos/` para dentro do root git e desativar submodules.

#### Fase 4 — Padronização de execução (contínuo)
1. Um `make -C backend status` / `backend/scripts/status.sh` para listar serviços, portas, saúde.
2. Um `backend/scripts/bootstrap.sh` para instalar dependências por módulo.
3. Um “perfil de dev” com as portas padrão do workspace (ex.: 5173/8099/3001/5006).

### 5) Próximos passos sugeridos (para eu executar)

Escolha 1 (rápido e seguro, sem grandes mudanças):
- criar `skincos/backend/docs/MODULES.md` + `skincos/backend/docs/HANDBOOK.md`;
- adicionar `backend/scripts/status.sh` e `backend/scripts/clean-local-artifacts.sh` (não destrutivo, com `--dry-run`);
- mover `integration/ef/config.json` para `integration/ef/config.local.json` e ajustar scripts para ler do `.local`.

Escolha 2 (reorganização completa):
- definir se será monorepo ou submodules;
- remover `.git` internos e consolidar versionamento;
- mover fisicamente módulos para `apps/{services,automations,agents}/` e `archive/`.

---

<!-- Source: backend/docs/UNIFICATION_AUDIT.md -->

## Auditoria de Unificação e Otimização (skincos)

Data: 2025-12-17

Objetivo: reduzir ambiguidade, manter **todas** as funcionalidades e deixar o monorepo mais simples de operar/evoluir.

### 1) Snapshot rápido (peso no disco)

Principais diretórios (aprox.):
- `backend/apps/actual-server/` (~8.3M)
- `backend/docs/` (~7.6M)
- `backend/apps/whatsapp/` (~4.4M)
- `backend/apps/agent-zero/` (~6.2M)
- `social/instagram/` (~4.8M)
- `frontend/` (~4.3M)
- `integration/ef/` (~2.9M)
- `backend/apps/whatsapp/chat-module/` (~1.3M)

Observação: os maiores “vilões” normalmente são `node_modules/`, `.venv/` e sessões/perfis. Hoje grande parte já foi reduzida (o restante é código/docs).

### 2) Unificações já aplicadas (sem quebrar execução)

- **Docs**: documentação de módulos está em `backend/docs/modules/*`.
- **GitHub**: `.github/` aninhados foram arquivados em `backend/archive/github/` (não são executados no GitHub Actions do monorepo); somente `/.github` do root é ativo.
- **VSCode**: `.vscode` aninhados foram consolidados em `/.vscode`.
- **EditorConfig**: `.editorconfig` consolidado no root.
- **Sprinta**: incorporado em `backend/apps/automations/sprinta/*`, com `.env` real em `backend/var/` e entrypoint via `backend/scripts/dev.sh sprinta`.
- **AgentZero**: módulo Python helper foi movido para `backend/apps/agent-zero/agentzero` (consumidores ajustados).

### 3) Duplicações relevantes (o que ainda causa ambiguidade)

#### 3.1 WhatsApp (intencional, mas precisa de “contrato” único)

Atualmente existem:
- `backend/apps/whatsapp/official-module/` (serviço “principal” recomendado; multi-instância)
- `backend/apps/whatsapp/gateway/` (gateway legacy + tooling)
- `backend/apps/whatsapp/official/` (fork/lib usada pelo official-module; não é o serviço em si)

Risco: usuários/rotinas apontarem para o módulo errado.  
Mitigação: manter `backend/scripts/*` como contrato único e atualizar docs para reforçar “canonical”.

#### 3.2 Vários monorepos Node “dentro” do monorepo

Existem workspaces independentes:
- `backend/apps/agent-zero/` (Nx/workspace)
- `backend/apps/whatsapp/chat-module/` (pacotes do chat-module)
- `backend/apps/whatsapp/gateway/` (packages/apps internos)
- `frontend/` + `backend/apps/crm-api/`
- `backend/apps/actual-server/` (app isolada)

Isso é normal, mas aumenta complexidade (locks, engines, scripts, CI).

#### 3.3 Scripts espalhados (muitos são internos)

O contrato do monorepo deveria ser somente `backend/scripts/*` + `backend/Makefile`.
Ainda existem `scripts/` internos em módulos (ex.: `backend/apps/agent-zero/tools/scripts`, `backend/apps/actual-server/src/scripts`, `backend/apps/whatsapp/gateway/tools/scripts`).

Sugestão: manter internos, mas **não** expor como entrada principal; criar wrappers no root apenas quando necessário.

#### 3.4 Config e segredos (padronização incompleta)

Status atual:
- Padrão bom já existe: `backend/config/workspace.local.env` (ignorado) carregado por `backend/scripts/env.sh`.
- Ainda existem `.env.*` em alguns módulos (ex.: `backend/apps/whatsapp/gateway/.env.dev` etc.) e configs locais por módulo.

Sugestão: convergir para:
- `backend/config/templates/modules/<modulo>/*.example`
- `backend/var/<modulo>/...` para estado/sessões
- `backend/config/workspace.local.env` para variáveis globais de dev

### 4) Oportunidades de eliminar/arquivar (sem perder funcionalidade)

Baixo risco:
- remover artefatos gerados (`__pycache__`, `*.pid`, `.DS_Store`, logs antigos).
- mover conteúdo claramente histórico para `archive/` (mantém conteúdo, reduz ruído).

Médio risco:
Médio risco:
- mover `backend/apps/whatsapp/stub/` para `archive/whatsapp/stub/` (se não houver uso).
- mover `tools/scripts/legacy-tests/` para `archive/tools/legacy-tests/` (se não houver uso).

Alto risco (precisa decisão + validação):
- consolidar/revisar chat-module (opcional) junto da stack Node (ex.: `backend/apps/whatsapp/*`) em um único workspace.
- transformar tudo em **um único** workspace Node (workspaces no root) — pode conflitar com Nx do `a0/`.

Nota (estado atual):
- Existe um workspace pnpm **opt-in** em `backend/` para unificar apenas apps Node simples (sem workspaces aninhados): ver `backend/docs/NODE_PACKAGE_MANAGEMENT.md`.

### 5) Proposta de arquitetura alvo (monorepo “legível”)

Sem mexer em runtime de imediato, mas como direção:
- `apps/` (UIs: CRM, dashboards)
- `services/` (APIs/servidores: WhatsApp official/gateway, actual-server, etc.)
- `apps/automations/` (scraper, sprinta)
- `agents/` (a0)
- `libs/` (código compartilhado Python/JS)
- `backend/config/` (templates e exemplos versionados; sem segredos)
- `backend/config/` (pacote Python `config` + symlinks para templates)
- `backend/var/` (estado local, sempre ignorado)
- `backend/scripts/` + `backend/Makefile` (contratos de execução)
- `backend/docs/` (inclui `backend/docs/<modulo>/*` + `backend/docs/internal/*`)

Compatibilidade: manter wrappers em `backend/scripts/` para caminhos antigos durante a migração.

### 6) Plano de ação (incremental, sem quebrar nada)

#### Fase A — “Higiene e contrato” (rápido)
1. Garantir que **tudo** roda via `backend/scripts/*` e `backend/Makefile` (sem usar paths internos diretamente).
2. Padronizar `VAR_DIR` em todos os scripts (logs/pids/sessões).
3. Rodar limpeza segura: `./backend/scripts/clean-local-artifacts.sh --dry-run` e depois `--apply`.

#### Fase B — Config/Estado padronizados
1. Criar `backend/config/templates/modules/*` e mover `*.example` para lá (mantendo symlinks de compatibilidade se necessário).
2. Migrar `.env.*` reais para `backend/var/` e/ou `backend/config/workspace.local.env`.
3. Ajustar wrappers para criar symlinks de compatibilidade (como no Sprinta).

#### Fase C — Reorganização física (quando estiver estável)
1. Migrar pastas para `apps/{services,automations,agents}/`.
2. Atualizar `backend/capabilities.json` e `backend/docs/MODULES.md`.
3. Remover aliases antigos quando não houver mais uso.

### 7) Check de “não quebrar”

Antes/depois de cada fase:
- `make -C backend status`
- `./backend/scripts/dev.sh restart` (stack principal)
- `./backend/scripts/dev.sh scraper diagnose`
- `./backend/scripts/dev.sh sprinta legacy --help` e `./backend/scripts/dev.sh sprinta v2 --help`

---

<!-- Source: backend/docs/NEXT_STEPS.md -->

## Próximos Passos (pós Fase C)

Data: 2025-12-17

Este documento organiza as próximas ações para continuar reduzindo complexidade **sem perder funcionalidades**.

### 1) Estabilização (recomendado primeiro)

1. Rodar smoke manual:
   - `./backend/scripts/status.sh`
   - `./backend/scripts/dev.sh restart` (ver logs em `backend/var/logs/`)
   - Se faltar dependência: `./backend/scripts/bootstrap.sh --core` (use `--force` se precisar reinstalar)
2. Executar limpeza segura:
   - `./backend/scripts/clean-local-artifacts.sh --dry-run`
   - `./backend/scripts/clean-local-artifacts.sh --apply` (quando estiver confortável)

Observação (CRM API):
- A API do CRM agora vive em `backend/apps/crm-api` e instala dependências mínimas lá (mais rápido e reduz “travas” por installs grandes). Para forçar: `./backend/scripts/bootstrap.sh --module crm --force`.

### 2) WhatsApp (reduzir duplicação sem quebrar contratos)

1. Declarar “canonical”:
   - Serviço: `backend/apps/whatsapp/official-module/`
   - Gateway legacy: `backend/apps/whatsapp/gateway/`
   - Library: `backend/apps/whatsapp/official/`
2. Stub/fallback: `backend/apps/whatsapp/stub/` (sem paths legados no root).
3. Garantir que todos os consumidores usem apenas `scripts/dev-*-watch.sh` e não paths internos.
   - Contrato canônico agora é `backend/scripts/dev-*-watch.sh`.

### 3) Workspaces Node (decisão de arquitetura)

Escolher uma abordagem:
- **A (conservadora)**: manter módulos separados (frontend, backend/apps/agent-zero, backend/apps/whatsapp, backend/apps/actual-server) e apenas padronizar scripts e env.
- **B (workspaces no root)**: criar workspaces no `package.json` do root e padronizar `npm/pnpm` + lockfiles (maior impacto).

### 4) Arquivamento adicional (baixo/médio risco)

- Revisar `backend/apps/whatsapp/stub/scripts/` e mover para `archive/whatsapp/stub/scripts/` se não houver uso.
- Revisar `backend/docs/internal/*` (conteúdos internos/gerados) e arquivar se não for usado no dia-a-dia.

### 5) Publicação (Cloudflare) — desenho alvo

- Frontend CRM: Cloudflare Pages.
- Backend/API: Cloudflare Workers/Pages Functions (ou Container no Cloudflare se necessário).
- Postgres: serviço externo (Neon/Supabase/RDS), via `DATABASE_URL` em `config/workspace.local.env`.
- Automações (backend/apps/automations/sprinta): manter como jobs internos (rodando sob demanda/local/cron) com estado em `backend/var/`.

Detalhe: `backend/docs/CLOUDFLARE_DEPLOYMENT.md`

---

<!-- Source: backend/docs/SIZE_REDUCTION.md -->

## Redução de Tamanho (sem perder funcionalidade)

Objetivo: manter o monorepo leve no disco **sem** apagar código nem quebrar execuções — removendo apenas artefatos regeneráveis e caches.

### Ferramentas

- Limpeza segura (não apaga sessões/perfis por padrão):
  - `./backend/scripts/clean-local-artifacts.sh --dry-run`
  - `./backend/scripts/clean-local-artifacts.sh --apply`
  - (opcional) incluir sessões WhatsApp: `./backend/scripts/clean-local-artifacts.sh --apply --include-sessions`
  - (opcional) incluir perfis de navegador: `./backend/scripts/clean-local-artifacts.sh --apply --include-browser-profiles`

- Sprinta: prune de perfis temporários (mantém os mais novos):
  - `./backend/scripts/prune-sprinta-profiles.sh --dry-run --keep 2`
  - `./backend/scripts/prune-sprinta-profiles.sh --apply --keep 2`

Observação: `--include-browser-profiles` também remove perfis do Sprinta (ex.: `backend/apps/automations/sprinta/legacy/chrome_profile_sprinta`), o que pode exigir re-login em automações.

### O que é seguro remover (regenerável)

- `node_modules/` (reinstala com `npm install`/`npm ci`)
- `.venv*/venv*/__pycache__/` (recria com `python -m venv ...` e `pip install -r requirements.txt`)
- `dist/`, `build/`, `.vite/`, caches e logs

### O que *não* remover sem intenção

- Sessões e autenticações (ex.: `.wa-sessions/`, `.wwebjs_auth*`)
- Perfis de navegador com login salvo (ex.: `.chrome_profile_*`, `.chrome-profile*`)

Se remover, o sistema continua “funcional”, mas você pode precisar autenticar de novo (WhatsApp/Google/Wix/etc.).

### Nota sobre WhatsApp

Se você rodar com `--include-sessions`, também serão removidos caches/sessões dentro de subpastas como:
- `backend/apps/whatsapp/official-module/.wwebjs_cache`
- `backend/apps/whatsapp/gateway/.wwebjs_auth_local_*`

---

<!-- Source: backend/docs/PORTS.md -->

## Portas padrão do workspace

Sugestão para evitar conflitos (desenvolvimento local):

- CRM Frontend (Vite): `5173` (`CRM_PORT`)
- CRM Backend (Express): `8099` (`CRM_API_PORT`)
- WhatsApp (instâncias): `3001..3009` (porta = `3000 + INST`)
- Actual Server: `5006` (`ACTUAL_PORT`)
- Sales Chart Messenger (se aplicável): `3200` (`SALES_CHART_MESSENGER_PORT`)

Notas:
- Alguns módulos legados ainda citam portas antigas em docs; padronizar docs conforme este arquivo.
