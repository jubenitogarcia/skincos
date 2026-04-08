# Espaço Facial (Open) — 2025-12-28

Este projeto é uma base **independente do Wix** para recriar o site `espacofacial.com`.

## Rodar localmente
```bash
npm install
npm run dev
```
Abra `http://localhost:3000`.

## Suíte de qualidade

Executar validações locais (sem reinstalar dependências):
```bash
npm run quality:check
```

Executar validações em modo CI (com `npm ci`):
```bash
npm run quality:ci
```

Para cobertura completa do smoke de agenda (`/api/agenda`), configure:
- `SMOKE_AGENDA_TOKEN` (ou `AGENDA_SYNC_TOKEN` como fallback)
- opcionalmente `SMOKE_AGENDA_UNIT`, `SMOKE_AGENDA_FROM`, `SMOKE_AGENDA_TO`

## Auditoria 360 (Design/UI/UX/SEO/Perf/A11y)

Executar auditoria completa e gerar relatório consolidado em `reports/quality/<timestamp>-audit360`:
```bash
npm run audit:360
```

Executar em modo CI (com reinstall de dependências):
```bash
npm run audit:360:ci
```

Saídas principais:
- `audit360-report.md` (resumo executivo e backlog)
- `summary.json` + `findings.json` (dados estruturados)
- `screenshots/` e `diffs/` (regressões visuais desktop/mobile)
- `a11y/*.json` (axe por página)
- `strategy-audit.json` (lentes estratégicas: técnico sênior, growth, direção de arte, performance marketing)
- `design-reform-backlog.json` (plano de reformas agressivas priorizado em P0/P1/P2)
- `design-reform-roadmap.md` (roteiro 0-14 / 15-45 / 46-90 dias)

## Topologia de domínios

Este app Next atende **dois sites públicos distintos** com branding e propósito diferentes:

- `espacofacial.com`
  - worker: `espacofacial-site`
  - foco: site público da Espaço Facial
  - rotas abertas: site institucional, unidades, doutores, agendamento e páginas legais da marca

- `skincos.com.br`
  - worker: `skincos-site`
  - foco: hub institucional/jurídico da SKINCOS e do app `ORB by SKINCOS`
  - rotas abertas: `/`, `/privacidade`, `/dados`, `/termos` e aliases jurídicos equivalentes

Importante:
- `orb.skincos.com.br` continua sendo um subdomínio técnico separado, via Cloudflare Tunnel, e **não** é servido por este worker.
- Não reaproveite `skincos.com.br` para páginas de agendamento/unidades da Espaço Facial.
- Não altere `website/wrangler.toml` para SKINCOS; use `website/wrangler-skincos.toml`.

## Colocar online (Cloudflare Workers via OpenNext)

Pré-requisitos:
- Wrangler configurado (login/token) para a conta/zona do Cloudflare.

Deploy do site da Espaço Facial:
```bash
npm run deploy
```

Observação:
- o deploy valida a presença de `public/production-snapshot/` antes de publicar; esse snapshot é a fonte local de fotos e avaliações da seção `Sobre Nós`, sem depender de chamadas pagas ao Google Places.

Deploy do hub jurídico da SKINCOS:
```bash
npm run deploy:skincos
```

Tail do worker da SKINCOS:
```bash
npm run tail:skincos
```

## Agendamento (MVP) — Cloudflare D1

O fluxo de agendamento em `/agendamento` usa dois bindings **Cloudflare D1**:
- `BOOKING_DB` para pedidos/reservas.
- `SKINCOS_ESCALA_DB` para equipe/escala (fonte CRM unificada para doutores e dias de atendimento).

Setup (produção/preview):
- Veja o guia: `docs/booking/SETUP_CLOUDFLARE_D1.md`
- Arquivo de exemplo para preview local: `.dev.vars.example`

## Instagram dos doutores (cache nativo no banco)

O modal de Instagram do site agora lê de cache persistido no `BOOKING_DB` (D1), com sync recorrente:
- Tabelas: `instagram_profiles`, `instagram_media`, `instagram_sync_runs`
- Migrations: `migrations/0003_instagram_cache.sql`, `migrations/0005_instagram_cache_rich_metadata.sql`
- Endpoint de sync protegido: `POST /api/instagram/sync`
  - Auth: `Authorization: Bearer <INSTAGRAM_SYNC_TOKEN>` (ou header `x-instagram-sync-token`)
  - Sem `handles` no payload, ele sincroniza automaticamente os handles dos doutores ativos do diretório
  - Para pré-carregar mais conteúdo por doutor, use `maxFeedItems` no payload (até `180`)

Automação:
- Workflow agendado: `.github/workflows/website-instagram-sync.yml` (a cada 30 min)
- Secret exigido no GitHub + Worker: `INSTAGRAM_SYNC_TOKEN`

Deploy do worker de redirects (domínio `esfa.co`):
```bash
npm run deploy:esfa
```

## Ver logs (produção)

Tail do Worker principal:
```bash
npm run tail
```

Observações:
- `--sampling-rate` precisa ser **entre 0 e 1** (ex.: `0.25`). `1` e `1.0` dão erro.
- Se aparecer `Network connection lost`, normalmente é apenas a conexão do tail que caiu — rode novamente.

Tail em JSON (útil para filtrar/processar):
```bash
npm run tail:json
```

Se o site “não atualizou” após deploy:
- Faça um hard reload no navegador (ou teste em aba anônima).
- Verifique no DevTools → Network → documento `/` se o header `cf-cache-status` está `HIT`.
- Se estiver `HIT`, faça purge do cache no Cloudflare (Caching → Purge Cache).

## Onde colocar imagens
- `public/images/hero.jpg` (banner principal)
- `public/images/579A1718.jpg` e `public/images/579A1718.png` (fotos do grid de doutores, se quiser manter)
- Demais imagens do carrossel e mapa.

## Próximos passos
- Preencher endereços e contatos das unidades
- Inserir textos completos de Sobre Nós e Termos
- Replicar carrossel de posts do Wix (slider)

## Tracking (Ads/SEO) — QA rápido

Objetivo: garantir que `utm_*` / `gclid` **não se perdem** e chegam nos eventos de clique (principalmente WhatsApp).

### 1) Teste de persistência e evento

1. Abra a home com parâmetros, por exemplo:
	- `http://localhost:3000/?utm_source=google&utm_medium=cpc&utm_campaign=teste&gclid=TESTE123`
2. Clique em **Agendar** (header/floating/sobre/doutor).
3. Verifique o payload do evento:
	- Ative debug via querystring: adicione `&ef_debug=1` na URL.
	- O console vai logar: `[analytics] cta_agendar_click { ... }` incluindo `utm_*`, `gclid` e `landingPeriod`.

### 2) Teste de redirect preservando params

1. Abra (exemplo):
	- `http://localhost:3000/barrashoppingsul/faleconosco?utm_campaign=teste&gclid=TESTE123`
2. Confirme que o redirect para o WhatsApp **mantém** `utm_campaign` e `gclid` na URL final.

### 3) Dica: debug persistente

Se quiser manter logs sem querystring:
- Rode no console: `localStorage.setItem('ef_debug','1')`.

## Operação mensal (landing muda por campanha)

O hero já suporta atualização sem deploy via `/api/hero-media` (Drive folder / manifest).

### Campanhas por unidade

A infraestrutura agora aceita campanha por unidade (fallback automático para campanha padrão):

- Home com query param: `/?unit=<slug-da-unidade>`
- Página da unidade: `/<slug-da-unidade>`

Ordem de resolução:
1. Campanha local da unidade (`LOCAL_HERO_ITEMS_BY_UNIT` em `src/lib/heroMediaShared.ts`)
2. Manifest/Drive da unidade (via variáveis de ambiente)
3. Campanha padrão global (desktop/mobile)

Variáveis de ambiente por unidade (substitua `<UNIT_KEY>` pelo slug normalizado em maiúsculas, ex.: `barrashoppingsul` -> `BARRASHOPPINGSUL`):

- Manifest:
  - `HERO_MEDIA_MANIFEST_URL_<UNIT_KEY>`
  - `HERO_MEDIA_MANIFEST_URL_MOBILE_<UNIT_KEY>`
- Drive folder:
  - `HERO_DRIVE_FOLDER_ID_<UNIT_KEY>`
  - `HERO_DRIVE_FOLDER_ID_MOBILE_<UNIT_KEY>`

Checklist mensal recomendado:
- Atualizar as mídias do hero (Drive folder / manifest)
- Publicar campanhas com UTMs padronizadas (ex.: `utm_source=google&utm_medium=cpc&utm_campaign=YYYY-MM_nome`)
- Validar `cta_agendar_click` com `ef_debug=1` em 2 dispositivos (mobile/desktop)
- Conferir redirects de WhatsApp preservando `utm_*`/`gclid`

## Segurança (GitHub + Cloudflare)

### Turnstile no agendamento (anti-bot)
- Guia: `docs/security/SETUP_TURNSTILE.md`
- Secrets no GitHub Actions:
  - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (publica)
  - `TURNSTILE_SECRET_KEY` (privada)
  - (opcional) `BOOKING_REQUIRE_TURNSTILE` (`1/true` para forçar em qualquer ambiente)

### Lock de prêmio da roleta (/cadastro)
- Segredos/config:
  - `CADASTRO_WHEEL_SECRET` (recomendado; fallback para `BOOKING_STATUS_SECRET` e `BOOKING_DECISION_SECRET`)
  - `CADASTRO_WHEEL_LOCK_HOURS` (opcional; default `24`, máximo `168`)
- Comportamento:
  - O prêmio é assinado no servidor e persistido em cookie HttpOnly, evitando novo sorteio após refresh/reentrada dentro da janela de lock.
- Deploy:
  - Defina `CADASTRO_WHEEL_SECRET` em `GitHub Actions secrets`; o workflow de deploy sincroniza automaticamente no Worker.

### Sync de regras de segurança (WAF/rate limit)
- Guia: `docs/security/SETUP_CLOUDFLARE_SECURITY_SYNC.md`
- Workflow:
  - `Sync Website Cloudflare Security` (manual + agendado)
- Verificação:
  - `npm run cf:security:check` valida drift de regras no Cloudflare.
