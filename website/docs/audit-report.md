# Audit Report — espacofacial.com (Next.js + OpenNext on Cloudflare Workers)

Data: 2026-01-18

## Contexto
- App: Next.js App Router rodando via OpenNext em Cloudflare Workers.
- Domínios:
  - Produção: https://espacofacial.com
  - Shortener/redirect: https://esfa.co

## Evidências (checks rápidos)
- `GET /` (prod)
  - Status: `200`
  - Header: `x-opennext: 1`
  - Cache-Control (HTML): `s-maxage=31536000, stale-while-revalidate=2592000`
- `GET https://www.espacofacial.com/` → `308` para `https://espacofacial.com/`
- `GET /robots.txt` → `200` (`content-type: text/plain`)
- `GET /sitemap.xml` → `200` (`content-type: application/xml`)
- `GET /nao-existe` → `404`
- `GET https://esfa.co/bss/faleconosco` → `301` para `https://espacofacial.com/barrashoppingsul/faleconosco`
- Security headers presentes (ex.: `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`)

## P0 — Corrigir imediatamente (produção/risco)
1. **Canônico/duplicidade www vs apex**
   - Situação: resolvido com redirect `308` `www` → apex.
   - Impacto: SEO (conteúdo duplicado), analytics duplicado, links divergentes.
   - Fix: redirect 308 `www` → apex + canonical consistente.

2. **Páginas de erro (500) / error boundary**
   - Situação: existe `not-found.tsx`, mas não há `error.tsx`/`loading.tsx` no root.
   - Impacto: falhas em runtime viram UX ruim/sem retry.
   - Fix: adicionar `src/app/error.tsx` + `src/app/loading.tsx`.

3. **Conteúdo com alegações não verificadas**
   - Situação: Home contém claims “+6 anos” e “+30 unidades”.
   - Impacto: risco de inconsistência/credibilidade (e potencial risco legal/marketing).
   - Fix: trocar por copy neutra com TODOs.

4. **Headers de segurança ausentes/baixos**
   - Situação: corrigido via `next.config.mjs` (HSTS, nosniff, referrer-policy, etc.).
   - Impacto: hardening fraco (principalmente para phishing/mime sniffing).
   - Fix: adicionar security headers via `next.config.mjs` (sem CSP agressiva por enquanto).

5. **Observação operacional (DNS/email)**
   - Registros de email (CNAME/DKIM) devem ficar **DNS only**, nunca proxied.
   - Não é fix em código; é fix em Cloudflare DNS.

## P1 — Melhorar (SEO/Perf/UX/Tracking)
1. **OpenGraph/Twitter image**
   - Fix aplicado: endpoints `GET /opengraph-image` e `GET /twitter-image` (SVG, runtime nodejs) para compatibilidade com OpenNext.

2. **Schema.org**
   - Fix: JSON-LD mínimo (Organization) com TODOs para campos que dependem do dono.

3. **Tracking (GA4/GTM via env vars)**
   - Fix: camada `dataLayer` + eventos de CTA (Agendar, Escolher unidade, etc.).
   - Variáveis suportadas: `NEXT_PUBLIC_GA4_ID`, `NEXT_PUBLIC_GTM_ID`.

4. **A11y: foco visível e links externos**
   - Fix: `:focus-visible` global, `rel="noopener noreferrer"` em links `target=_blank`.

5. **Smoke tests automatizados**
   - Fix: script que valida status/redirects de rotas críticas.

6. **Dependências (vulnerabilidades transitivas)**
   - Fix: `overrides` em `package.json` para atualizar dependências transitivas vulneráveis (ex.: `glob` do lint e `undici` do `wrangler/miniflare`) sem mexer em `next`/OpenNext.
   - Status: `npm audit` ficou apenas com vulnerabilidades **low** vindas da árvore AWS SDK usada pelo OpenNext; a correção exigiria upgrades/downgrades com potencial breaking change, então foi deixado como follow-up.

## P2 — Evoluções
- Melhorar conteúdo real por unidade (endereço, mapa, horários, equipe) via CMS.
- Revisão de performance com Lighthouse real (LCP/INP/CLS) e images/font strategy.
- CSP com nonce (após estabilizar scripts de analytics).
