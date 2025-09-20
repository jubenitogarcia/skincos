# Root Scripts Hub

Run submodule services from the repository root. These wrappers delegate to scripts inside each submodule, so ownership stays with each module.

## Available wrappers

- CRM
  - `scripts/crm-dev.sh` → comprehensive-crm-so/scripts/restart_crm.sh
- Agent Zero
  - `scripts/agent-dev.sh` → a0/run_ui.py (or a0/tools/scripts/restart.sh)
- WhatsApp Gateway
  - `scripts/gateway-dev.sh` → whatsapp-gateway/bot_com_api.js (or start.sh)
- BroadHub
  - `scripts/broadhub-dev.sh` → broadhub/run.sh or python main.py

## Usage

```bash
# CRM (API + Frontend)
./scripts/crm-dev.sh --tail --watch --crm-port 5173 --crm-api-port 3100

# Agent Zero (UI)
./scripts/agent-dev.sh --port 50001

# WhatsApp Gateway (basic dev)
./scripts/gateway-dev.sh

# BroadHub (venv optional)
./scripts/broadhub-dev.sh
```

These scripts only wrap existing module scripts; adjust flags as needed.
