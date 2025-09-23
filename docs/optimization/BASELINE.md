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
- comprehensive-crm-so (Vite + React + Express API)
- whatsapp/official-module (WhatsApp Web.js server)
- whatsapp/official (local clone of whatsapp-web.js)
- agent-zero-module (agents)
- broadhub (broadcast hub)

## Dependency Manifests (top-level)
- Root: package.json
- CRM: comprehensive-crm-so/package.json
- WA Official Module: whatsapp/official-module/package.json
- WA Library: whatsapp/official/package.json
- Agent Zero: agent-zero-module/package.json

## Open Questions
- Current release version and tagging strategy
- CI matrix and environments
- Performance targets (latency, throughput)
- Security baselines (CodeQL, gitleaks)

## Next
- Inventory manifests and detect outdated deps
- Capture latency baselines for API and WA endpoints
- Propose consolidation and upgrade plan
