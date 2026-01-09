# Instagram (vendorizado no monorepo)

Estrutura:

- `instagrapi/` — biblioteca vendorizada (upstream) + docs/compose.
- `module/` — serviço SKINCOS (API Node + módulo Python) que usa `instagrapi`.

Entrypoints (dev):

- do repo root: `node backend/apps/instagram/module/instagram_api_server.js` (default `INSTAGRAM_PORT=3003`)
- do repo root: `python3 backend/apps/instagram/module/api/instagram_api.py` (se usado no seu fluxo)
