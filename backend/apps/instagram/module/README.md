# Instagram Module (backend/apps/instagram/module)

Serviço Instagram do SKINCOS: API Node + módulo Python (OSINT/automação/download), usando `instagrapi` vendorizado em `backend/apps/instagram/instagrapi/`.

## Start
- API Node: `./backend/scripts/dev.sh instagram-module start` (env `INSTAGRAM_PORT`, default 3103)
- Python (se usado no fluxo): `python3 backend/apps/instagram/module/instagram_main.py`
- Sync autenticado do site: `python3 backend/apps/instagram/module/instagram_site_sync.py`

## Config
- Local (ignorado): `backend/apps/instagram/module/config/config.local.json`
- Template: `backend/config/templates/modules/instagram-module/config.example.json`
- Override por env: `INSTAGRAM_CONFIG=/caminho/arquivo.json`

## Estado local
- Preferir `backend/var/instagram-module/` para dados locais (symlinks já apontam para `backend/var/`).

## Sync do site
- O fluxo principal do site usa `instagrapi` via `backend/apps/instagram/module/instagram_site_sync.py`.
- Esse script foi desenhado para GitHub Actions, com sessão persistida em arquivo (`INSTAGRAPI_SESSION_FILE`) e ingestão no cache do website via `POST /api/instagram/ingest`.
- Quando o sync autenticado não está configurado ou falha parcialmente, o website cai para o método web atual como fallback.
