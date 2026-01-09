# Agent Zero (unificado)

Situação atual no monorepo:

- **Root principal (canônico):** `backend/apps/agent-zero/`
- **Integrated (Node servers/UI):** `backend/apps/agent-zero/integrated/`

Entrypoint recomendado:
- `./backend/scripts/dev.sh agent`

Estado local (recomendado):
- usar `VAR_DIR` (`./backend/scripts/env.sh`) + `./backend/scripts/migrate-var.sh` para manter `backend/apps/agent-zero/tmp`, `backend/apps/agent-zero/logs`, `backend/apps/agent-zero/work_dir`, `backend/apps/agent-zero/storage` fora do código.
