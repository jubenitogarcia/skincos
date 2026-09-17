# Capabilities (skincos)

Modelo: cada domínio é dono do seu runtime e dos seus dados; capabilities
compartilhadas são consumidas por contratos versionados via HTTP/jobs.

Arquivo de catálogo:
- `backend/capabilities.json`

Objetivo:
- Manter cada produto publicável sem depender de `spawn` local ou do checkout de
  outro produto.
- Rodar capabilities “pesadas” (WhatsApp Web, Selenium, Python long-running) fora do Cloudflare (ex.: VPS/PC/Docker), expostas por tunnel e autenticadas.
