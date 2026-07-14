# Roadmap — produção (Cloudflare Workers)

## Fase 0 — Estabilização (P0)
1. Canonical: redirect `www` → apex; alinhar canonical.
2. Error/Loading boundaries no App Router.
3. Remover/neutralizar claims não verificadas; marcar TODOs.
4. Security headers básicos (sem CSP agressiva).
5. (Operacional) DNS: remover restos Wix no apex; garantir email records DNS-only.

## Fase 1 — SEO + Tracking (P1)
1. `opengraph-image` + `twitter-image` dinâmicos.
2. Schema.org Organization (com TODOs).
3. Analytics opcional via env vars:
   - `NEXT_PUBLIC_GA4_ID`
   - `NEXT_PUBLIC_GTM_ID` (opcional)
4. Eventos: cliques em CTAs de agendamento e seleção de unidade.

## Fase 2 — Qualidade e crescimento (P2)
1. Conteúdo por unidade (N páginas de conversão): `/unidades/[slug]` enriquecida.
2. Performance: imagens reais otimizadas, font strategy, revisão de cache-control HTML.
3. Marketing:
   - Plano de campanhas + UTM + páginas de destino (landing pages)
   - Medição de funil (view → click → contato)

## Riscos / Observações
- CSP forte pode quebrar Next/analytics; implementar apenas com nonce.
- Claims de marketing devem ser confirmadas pelo dono antes de publicar.
