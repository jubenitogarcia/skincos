# Turnstile (anti-bot) — Setup

O formulário de agendamento (`/agendamento` -> `POST /api/booking/request`) suporta Cloudflare Turnstile.

## 1) Criar o Turnstile no Cloudflare

- Cloudflare Dashboard -> Turnstile -> Add site
- Domínios: `espacofacial.com` (e `www.espacofacial.com` se necessário)
- Salve:
  - **Site key** (publica)
  - **Secret key** (privada)

## 2) Configurar secrets no GitHub Actions

No repositório do GitHub:

- Settings -> Secrets and variables -> Actions -> New repository secret
  - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = Site key (publica)
  - `TURNSTILE_SECRET_KEY` = Secret key (privada)

O deploy já está configurado para:
- Injetar `NEXT_PUBLIC_TURNSTILE_SITE_KEY` no build/deploy do Worker.
- Sincronizar `TURNSTILE_SECRET_KEY` no Worker (`wrangler secret put`) quando o secret existir.

## 3) Ambiente local (opcional)

Para preview local via Wrangler/OpenNext, configure em `.dev.vars`:

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY=...`
- `TURNSTILE_SECRET_KEY=...`

Veja `.dev.vars.example`.

## Comportamento

- Se `NEXT_PUBLIC_TURNSTILE_SITE_KEY` não existir: o widget não aparece.
- Se `TURNSTILE_SECRET_KEY` não existir: o backend não valida (não bloqueia).

