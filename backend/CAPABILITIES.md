# Capabilities (skincos)

Modelo: **CRM = core**, e o restante são **capabilities** (serviços/agentes/automações) que o CRM consome via HTTP/jobs.

Arquivo de catálogo:
- `backend/capabilities.json`

Objetivo:
- Deixar o CRM publicável (Cloudflare) sem depender de `spawn` local.
- Rodar capabilities “pesadas” (WhatsApp Web, Selenium, Python long-running) fora do Cloudflare (ex.: VPS/PC/Docker), expostas por tunnel e autenticadas.
