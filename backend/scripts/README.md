# Scripts Hub (Dev)

## Single entry point (recommended)

Use this to start the whole stack during development. It first kills common dev ports, then starts:
- CRM API (Express, default :8099) with nodemon
- CRM Frontend (Vite, default :5173)
- WhatsApp module on :3001 (prefers the official module; falls back to gateway stub if absent)

```bash
# Recommended CLI
./backend/scripts/dev.sh restart

# Or via Makefile wrapper
make -C backend dev
```

Environment knobs:
- `CRM_PORT` (default 5173)
- `CRM_API_PORT` (default 8099)
- `GW_INSTANCE` (1..9 → port 3000+N, default 1)
- `USE_OFFICIAL` (1 to force official, 0 to force gateway stub; default auto-detect official dir)
- `UNIFIED_AUTOSTART_ON_READY` (default false). When true, the CRM orchestrator will automatically POST /start-client to the official module once it’s listening on :3001.

Kill behavior (safe best-effort):
- Kills FE port (CRM_PORT), API port (CRM_API_PORT) and WhatsApp ports 3001–3009 if in use
- Also kills previous CRM processes by pattern (vite/express of this repo)

## Notes

- Prefer `./backend/scripts/dev.sh watch` (CRM + WhatsApp watchers).
- Legacy aliases (kept for compatibility):
  - `./backend/scripts/dev-all-watch.sh`
  - `./backend/scripts/dev-official-watch.sh`
  - `./backend/scripts/dev-gateway-watch.sh`
