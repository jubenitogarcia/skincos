# Checklist final de validação

## Comandos
- Suíte completa (CI):
  - `npm run quality:ci`
- Suíte completa (local, sem reinstalar deps):
  - `npm run quality:check`
- Smoke isolado (rotas críticas + agenda obrigatório):
  - `npm run smoke:strict`
- Auditoria 360 (design/ui/ux/seo/perf/a11y):
  - `npm run audit:360`

## URLs para conferir
- Home: https://espacofacial.com/
- Unidades: https://espacofacial.com/unidades
- Doutores: https://espacofacial.com/doutores
- Robots: https://espacofacial.com/robots.txt
- Sitemap: https://espacofacial.com/sitemap.xml
- 404: https://espacofacial.com/nao-existe

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
