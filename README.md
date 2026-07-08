# skincos

Plataforma interna (local) para automações e operações da clínica.

## Estrutura (source of truth)
- Backend: `backend/` (apps, automations, libs, tools, scripts)
- Frontend (CRM/UI): `frontend/`
  - Meta Ads (migrado): API em `backend/apps/meta-ads` e modulo UI no CRM
- Website público (Next.js): `modules/site-public/website/`
  - Fluxo de agendamento, APIs de booking e deploy Cloudflare/OpenNext

## Como rodar (local)
- Stack principal (recomendado): `./backend/scripts/dev.sh watch`
- CRM (frontend + API): `./frontend/restart_crm.sh --watch-full`
- CRM local production-like: `npm run crm:local`
- Preflight de autonomia Codex/deploy: `npm run codex:preflight`
- Operação nativa no Codex App: `docs/codex-app-native.md`
- Website público: `npm run website:dev` (porta padrão do Next: `http://localhost:3000`)
- macOS (sem terminal): dê duplo clique em `start-platform.command`
 - Meta Ads (API + worker): `./backend/scripts/meta-ads.sh start`

### Website público (migrado para este repositório)
- Instalar dependências do website: `npm run website:install`
- Rodar typecheck: `npm run website:typecheck`
- Build de produção: `npm run website:build`
- Deploy Cloudflare/OpenNext: `npm run website:deploy`
- O código legado do site agora está sob `modules/site-public/website/` e deve ser mantido aqui para evoluções futuras.

### Auth local (sem login manual)
- Em `localhost`, o bypass de auth **só é ativado com flag explícita** (`LOCAL_AUTH_BYPASS=true` ou `VITE_LOCAL_AUTH_BYPASS=true`).
- Para habilitar bypass no frontend local: `VITE_LOCAL_AUTH_BYPASS=true npm run dev`.
- Overrides úteis (frontend local): `VITE_LOCAL_AUTH_ROLE`, `VITE_LOCAL_AUTH_EMAIL`, `VITE_LOCAL_AUTH_NAME`.
- Em Pages Functions local (`npm run dev:pages`), `requireCrmUser` só faz bypass em `localhost` quando a flag acima estiver ativa.
- No CRM API local (`backend/apps/crm-api/server.js`), o stub de sessão dev exige `NO_AUTH=true` (não é mais default).
- O bypass de Basic Auth local no CRM API exige `CRM_LOCAL_NO_AUTH=true` (somente localhost).
- Escala em local (`npm run dev`, `./frontend/restart_crm.sh` e `npm run dev:pages`): padrão em `frontend/.dev.vars` é leitura de dados reais (`LOCAL_ESCALA_MOCK=false`, `ESCALA_API_TARGET=https://escala-api.skincos.com.br`) com escrita sombra local (`LOCAL_ESCALA_SHADOW_WRITES=true`).
- Efeito da escrita sombra: o CRM local confirma CRUD e reflete as mudanças localmente, mas **não grava no banco online**.
- Para isso, configure `ESCALA_ACTOR_HMAC_KEY` real em `frontend/.dev.vars`; sem essa chave, as leituras reais da Escala retornam erro de autenticação.
- A sombra local da Escala agora persiste entre reinícios em `frontend/.local/escala-shadow.json` (ignorado pelo git). Para desligar isso: `LOCAL_ESCALA_SHADOW_PERSIST=false`.
- Diagnóstico local da Escala:
  - `GET /api/escala/_proxy-status` mostra se o modo ativo é `local-mock`, `upstream` ou `upstream+local-shadow`.
  - `GET /api/escala/_local-shadow` lista as operações locais persistidas.
  - `DELETE /api/escala/_local-shadow` limpa a sombra local e força o CRM a voltar ao estado puro do upstream.

## Módulo Ponto (face + PIN)
- Backend (CRM API): expõe endpoints em `/api/ponto/*` e persiste em `backend/var/core/` (ignorado do git).
- Config (env): `PONTO_ADMIN_TOKEN` (rotas admin) e `PONTO_ACTOR_HMAC_KEY` (assinatura do actor para rotas `/me/*` via Pages proxy).
- Config (env, opcional): `PONTO_TEMPLATES_KEY` (AES-256-GCM p/ templates faciais em repouso), `PONTO_AUDIT_HMAC_KEY` (HMAC da trilha de auditoria), `PONTO_FACE_THRESHOLD`, `PONTO_PUNCH_COOLDOWN_SECONDS`.
- Frontend: baixe os modelos faciais para `frontend/public/face-models/` com `cd frontend && npm run fetch-face-models`.
- Fluxo recomendado: Admin cadastra funcionário (email + PIN + unidade) e opcional biometria → Funcionário bate ponto direto no CRM (Face → PIN) → Admin exporta e audita. Dispositivos são opcionais via “Gerenciar Dispositivo”.

## Redes Sociais (Instagram/Facebook/Threads)
- Config (env, recomendado): `INTEGRATIONS_ENCRYPTION_SECRET` (AES-GCM p/ tokens em repouso no R2).
- Config (env, recomendado): `REQUIRE_INTEGRATIONS_ENCRYPTION_SECRET=true` (falha fechado se o secret não estiver configurado).
- Config (env, recomendado): `R2_KEY_PREFIX` (ex: `preview/`) para isolar dados de R2 entre ambientes (preview ≠ production).
- Config (env, opcional): `SOCIAL_MEDIA_MAX_AGE_DAYS` e `SHARE_MAX_AGE_DAYS` (se definidos, links públicos antigos passam a retornar 404).
- Config (env, opcional): `SOCIAL_ADMIN_EMAIL_ALLOWLIST` (lista de emails, separados por vírgula, exigidos para ações de admin Social).
- Config (env, opcional): `SOCIAL_ADMIN_ROLE_ALLOWLIST` (lista de roles, separados por vírgula, permitindo admin Social sem token).
- Publicação manual agora **enfileira job** em `social/jobs/*` e o Worker `social-publisher` processa (habilite `SOCIAL_JOBS_ENABLED=true`).
- Endpoint de status de job: `GET /api/social/job-status?jobId=...` (retorna `pending|done|unknown`).

### Dev local (Social via Pages Functions)
- Recomendado: `cd frontend && npm run dev:pages` (sobe Vite + Pages Functions com bindings locais).
- Acesse `http://localhost:8788` (Pages) — a UI usa Functions reais (`/api/social/*`, `/social-media/*`).
- Se precisar de variáveis locais, crie `frontend/.dev.vars` (ignorado) com, por exemplo:
  - `SOCIAL_ADMIN_TOKEN=...`
  - `INTEGRATIONS_ENCRYPTION_SECRET=...`
  - `REQUIRE_INTEGRATIONS_ENCRYPTION_SECRET=true`

### Testar CRM local
- Launcher recomendado: `npm run crm:local`
- Atalho direto para o módulo Meta Ads: `npm run crm:local:meta-ads`
- Atalho direto para o módulo Site EF: `npm run crm:local:site-tracking`
- Atalho direto para o módulo Atend. Clínica: `npm run crm:local:atendimento-clinica`
- Atalho recomendado no Codex App para CRM genérico sem abrir Chrome externo: `npm run codex:crm:local`
- Atalho recomendado no Codex App para Atend. Clínica sem abrir Chrome externo: `npm run codex:crm:atendimento-clinica-local`
- Diagnóstico read-only de memória/portas do CRM no Codex: `npm run codex:memory:crm`
- Encerrar instâncias locais rastreadas do CRM: `npm run codex:crm:local-stop`
- Atalho macOS: `./start-crm-local.command`
- Atalho macOS para Site EF: `./start-crm-site-tracking-local.command`
- Atalho macOS para Atend. Clínica: `./start-crm-atendimento-clinica-local.command`
- Perfil default: `realistic`
  - sobe o CRM via `Pages Functions` local (`frontend/scripts/dev_pages.sh`)
  - ativa bypass local de auth apenas em `localhost`
  - preserva os módulos que já suportam leitura real com segurança, como `Escala`
- Para testar a sessão real sem bypass: `CRM_PROFILE=session npm run crm:local`
- Para testar `Insumos` sem tocar a produção:
  - `CRM_WITH_INSUMOS=1 npm run crm:local`
  - opcionalmente, use snapshot local:
    - exportar snapshot remoto: `node backend/scripts/insumos-d1-export.cjs backend/var/local/insumos-snapshot.latest.json`
    - subir o CRM com seed local: `CRM_WITH_INSUMOS=1 CRM_INSUMOS_SNAPSHOT=backend/var/local/insumos-snapshot.latest.json npm run crm:local`
- Para testar `Meta Ads` antes de publicar:
  - fluxo local simplificado e production-like: `npm run crm:local:meta-ads`
    - abre o CRM já no módulo `Meta Ads`
    - no perfil `realistic`, usa por padrão o cenário local `connected-ready`
    - esse cenário simula conexão, seleção de conta, visão geral e inventário apenas em `localhost`
    - fora do Codex App, por padrão o launcher gera `build` do frontend antes de subir, para o shell local refletir a versão mais próxima do online; dentro do Codex App, o build prévio é pulado por padrão para reduzir memória, e pode ser forçado com `CRM_BUILD_BEFORE_START=1`
    - também suprime preloads globais irrelevantes para esse foco local, como o status do Instagram
  - para validar o fluxo inicial de setup: `CRM_META_ADS_SCENARIO=disconnected npm run crm:local:meta-ads`
  - para testar estado de sessão expirada: `CRM_META_ADS_SCENARIO=unauthorized npm run crm:local:meta-ads`
  - para forçar a integração real publicada no Pages local, sem mock do módulo: `CRM_META_ADS_SCENARIO=live npm run crm:local:meta-ads`
  - para pular o build prévio quando você só quiser iterar rápido em UI local: `npm run crm:local:meta-ads -- --skip-build`
  - para rodar uma smoke automatizada do módulo após subir o CRM:
    - `npm run crm:local:meta-ads -- --smoke`
    - por padrão a smoke roda Playwright em modo headless e não abre janela; para debug visual use `npm run crm:local:meta-ads -- --smoke --headed-smoke --browser`
- Para testar `Site EF` / tracking do site antes de publicar:
  - fluxo local simplificado: `npm run crm:local:site-tracking`
    - abre o CRM já no módulo `Site EF`
    - usa o cenário local `connected-ready`, que também habilita o mock local de tracking agregado em `localhost`
    - para pular o build prévio quando você só quiser iterar rápido em UI local: `npm run crm:local:site-tracking -- --skip-build`
    - para rodar a validação automatizada sem abrir janela: `npm run crm:local:site-tracking -- --smoke`
  - no macOS, também é possível abrir por duplo clique em `start-crm-site-tracking-local.command`
- Para testar `Atend. Clínica` antes de publicar:
  - fluxo local com `crm-api` + frontend: `npm run crm:local:atendimento-clinica`
    - abre o CRM já no módulo `Atend. Clínica`
    - sobe o `crm-api` local com `NO_AUTH=true` e `atendimento-clinica` liberado no usuário dev
    - usa `DATABASE_URL` do ambiente para carregar dados reais do módulo
    - por padrão não roda build prévio, para abrir rápido e evitar ruído de chunks grandes no teste manual
    - dentro do Codex App, o launcher não abre Chrome externo por padrão; use o URL impresso no browser embutido ou rode `npm run codex:crm:atendimento-clinica-local`
    - fora do Codex App, o atalho macOS continua abrindo navegador automaticamente; para forçar manualmente use `--browser`, e para impedir use `--no-browser`
    - para validar também o build antes de abrir: `npm run crm:local:atendimento-clinica -- --build`
    - para rodar a validação automatizada sem abrir janela: `npm run crm:local:atendimento-clinica -- --smoke --exit-after-smoke`
  - no macOS, também é possível abrir por duplo clique em `start-crm-atendimento-clinica-local.command`

### Testar website local
- Launcher recomendado: `npm run website:local`
- Atalho recomendado no Codex App sem abrir Chrome externo: `npm run codex:website:local`
- Encerrar a instância local rastreada do website: `npm run codex:website:local-stop`
- Dentro do Codex App, `scripts/run-local-website.sh` não abre navegador externo por padrão; use o URL impresso no browser embutido. Fora do Codex App, o comportamento manual continua abrindo navegador automaticamente, salvo `--no-browser`.

## Docs
- Mapa do backend: `backend/docs/INDEX.md`
- Política de lockfiles: `backend/docs/LOCKFILES.md`
- Segredos e rotação: `docs/secrets-rotation.md`
- Autonomia Codex/deploy: `docs/codex-autonomy.md`
- Codex App nativo: `docs/codex-app-native.md`
- Workspace compartilhado Codex: `docs/codex-shared-workspace.md`
- Bootstrap de threads compartilhadas: `docs/codex-thread-bootstrap.md`
- Runbook de autonomia multiusuário: `docs/runbooks/mini-pc-autonomia-multiusuario.md`
- Observabilidade/SLOs: `docs/observability.md`
- Catálogo de serviços: `docs/service-catalog.md`
- Ownership e operação: `docs/ownership-model.md`
- Controle estratégico: `docs/strategic-control-plan.md`
- Workflow de criativos WhatsApp (prompt system): `backend/docs/modules/crm/whatsapp-creative-workflow.md`

## CRM (banner de demo)
- `VITE_DEMO_DATA=false` para ocultar o aviso de dados simulados quando tudo estiver integrado.

## Sanity check
- Suite rápida (recomendado): `./backend/scripts/doctor.sh`
- Quality gates críticos: `npm run quality:critical`
