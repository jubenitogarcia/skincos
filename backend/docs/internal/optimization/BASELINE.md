# Optimization Baseline

Date: 2025-09-21

## Repository
- Name: skincos
- Owner: jubenitogarcia
- Default branch: main

## Environments and Ports (dev)
- Frontend (Vite): 5173
- CRM API (Express): 8099
- WhatsApp Official Module: 3001

## Known Modules
- frontend (Vite + React)
- backend/apps/crm-api (Express API)
- backend/apps/whatsapp/official-module (WhatsApp Web.js server)
- backend/apps/whatsapp/official (local clone of whatsapp-web.js)
- backend/apps/agent-zero (Agent Zero)
- backend/apps/automations/sales_chart_messenger (sales chart messenger)

## Dependency Manifests (top-level)
- Root: package.json
- CRM: frontend/package.json
- CRM API: backend/apps/crm-api/package.json
- WA Official Module: backend/apps/whatsapp/official-module/package.json
- WA Library: backend/apps/whatsapp/official/package.json
- Agent Zero: backend/apps/agent-zero/package.json

## Open Questions
- Current release version and tagging strategy
- CI matrix and environments
- Performance targets (latency, throughput)
- Security baselines (CodeQL, gitleaks)

## Next
- Inventory manifests and detect outdated deps
- Capture latency baselines for API and WA endpoints
- Propose consolidation and upgrade plan
