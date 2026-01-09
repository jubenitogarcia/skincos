# SKINCOS AI (Monorepo)

Este repositório é um monorepo com:
- `backend/` (orquestração, apps, automações, ferramentas e docs)
- `frontend/` (CRM + packages)

## Entrypoints (local)

- Dev/watch principal: `./backend/scripts/dev.sh watch`
- Stack principal (CRM + WhatsApp): `./backend/scripts/dev.sh restart`
- Health/sanity: `./backend/scripts/doctor.sh`

## Estrutura (source of truth)

- Apps/serviços: `backend/apps/*`
  - Automações/jobs: `backend/apps/automations/*`
- Scripts/orquestração (contrato canônico): `backend/scripts/*`
- Config templates (sem segredos): `backend/config/{modules,examples}/*`
- Estado local/runtime (ignorado): `backend/var/*`
- Docs: `backend/docs/*`

## Regras

- Não comitar segredos: usar `backend/config/workspace.local.env` e arquivos `*.local*` ignorados.
- Preferir rodar módulos via `backend/scripts/dev.sh` (evita paths internos).
- Após mudanças: rodar `./backend/scripts/doctor.sh`.

