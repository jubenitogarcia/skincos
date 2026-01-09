# WhatsApp Path/Port Migration - Change Log

Date: 2025-09-21

Scope: Normalize legacy references to standardized dev topology
- WhatsApp Gateway/Stub: 3001
- CRM Frontend (Vite): 5173
- CRM Backend (Express): 8099
- Centralized module path: `backend/apps/whatsapp/official-module`

## Changes

1) Docs
- backend/docs/modules/whatsapp/WHATSAPP_QUICK_REFERENCE.md
  - Updated overview with dev defaults (3001/5173/8099)
  - Replaced many 3003 examples with 3001 equivalents
  - Updated web UI and file locations to `whatsapp/official-module`
  - Added quick dev checks for 5173/whatsapp proxy

2) Tests
- crm/src/components/__tests__/WhatsAppBusinessHub.smoke.test.tsx
  - Mocked whatsappGatewayAdapter.detectEndpoints to baseUrl http://localhost:3001

3) Scripts
- backend/scripts/dev.sh watch (alias: dev-all-watch.sh)
  - Set CRM_API_PORT default to 8099 (was 3100)

## Notes
- Some legacy sections still describe the old 3003 service for historical context; new flows should prefer 3001.
- Further passes should update remaining markdowns referencing 3003/5000 where applicable (architecture/operational docs) and align any residual proxies.

## Verification
- curl http://localhost:5173/whatsapp/health → 200 (proxy to 3001)
- curl http://localhost:8099/health → 200
- curl http://localhost:3001/health → 200

## Smoke Test Snapshot (2025-09-21)

Environment: macOS, Node 18+, Vite 6

- WhatsApp Official Module (3001)
  - Started with bundled Chromium path (Puppeteer):
    CHROMIUM_EXECUTABLE_PATH set to whatsapp/official/node_modules/puppeteer-core/.local-chromium/.../Chromium
  - NO_AUTH=true enabled to bypass API key during dev.
  - /health responded 200; QR generated (dev only).

- CRM API (8099)
  - Started with absolute path to backend/apps/crm-api/server.js.
  - /api/wa-orchestrator/status responded with channels array.

- Frontend (5173)
  - Vite bound on 5173 with proxy /whatsapp → http://localhost:3001 (rewrite working).

- Orchestrator integration
  - GET /api/wa-orchestrator/channels/1 showed network_error at one point while WA endpoints were still stabilizing.
  - Action: ensure only the Official Module binds 3001 (kill any bot_com_api.js stubs) before start, then retry.

Next Steps:
1) Always free 3001 before WA start: lsof -i :3001 → kill.
2) Start WA with NO_AUTH=true and CHROMIUM_EXECUTABLE_PATH on macOS.
3) Verify /api/status and /api/qr (200), then POST /api/wa-orchestrator/channels/1/start and observe status transitions.
4) Confirm proxy: curl http://localhost:5173/whatsapp/health → 200.
