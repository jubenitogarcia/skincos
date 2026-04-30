# Checklist final de validação

## Comandos
- Suíte completa (CI):
  - `npm run quality:ci`
- Suíte completa (local, sem reinstalar deps):
  - `npm run quality:check`
- Smoke isolado (rotas críticas + agenda obrigatório):
  - `npm run smoke:strict`
  - (equivale a `SMOKE_REQUIRE_AGENDA=1 node scripts/smoke.mjs`)
- Auditoria 360 (design/ui/ux/seo/perf/a11y):
  - `npm run audit:360`

## URLs para conferir
- Home: https://espacofacial.com/
- Unidades: https://espacofacial.com/unidades
- Doutores: https://espacofacial.com/doutores
- Robots: https://espacofacial.com/robots.txt
- Sitemap: https://espacofacial.com/sitemap.xml
- 404: https://espacofacial.com/nao-existe

## Política de domínios
- `espacofacial.com`:
  - domínio público canônico deste projeto
  - usado para mídia paga do site, páginas institucionais deste app e agendamento
- `www.espacofacial.com`:
  - deve sempre responder com `308` para `https://espacofacial.com`
- `espacofacial.com.br`:
  - domínio oficial separado da franquia
  - não deve compartilhar sessão/cookies/consentimento com este app
- `app.espacofacial.com.br`:
  - app oficial separado da franquia
  - não deve ser tratado como continuação do funil de tracking deste site
- `skincos.com.br`, `crm.skincos.com.br`, `orb.skincos.com.br`, `wa.skincos.com.br`:
  - domínios oficiais da SKINCOS para jurídico, CRM, automação e WhatsApp
  - não são hosts de navegação pública do funil de booking deste site

## Verificações de domínio
- `curl -sSIL https://www.espacofacial.com/ | head`
- `curl -sSIL https://espacofacial.com/ | head`
- `curl -sSIL https://espacofacial.com.br/ | head`
- `curl -sSIL https://app.espacofacial.com.br/ | head`
- `curl -sSIL https://crm.skincos.com.br/ | head`
- Confirmar que campanhas para booking usam `https://espacofacial.com/...`, não `.com.br`.

## Redirects críticos
- Shortener:
  - https://esfa.co/bss/faleconosco
  - https://esfa.co/nh/faleconsco
- Domínio principal (vai para WhatsApp):
  - https://espacofacial.com/barrashoppingsul/faleconosco
  - https://espacofacial.com/novohamburgo/faleconosco

## Sem loops
- Rodar:
  - `curl -sSIL https://esfa.co/bss/faleconosco | head`
  - `curl -sSIL https://espacofacial.com/barrashoppingsul/faleconosco | head`

## Operacional (Cloudflare DNS)
- Registros de e-mail (MX/TXT/DKIM) devem ser **DNS only**.
- Ideal: não manter A records do Wix no apex.
