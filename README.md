# skincos

Plataforma interna (local) para automações e operações da clínica.

## Estrutura (source of truth)
- Backend: `backend/` (apps, automations, libs, tools, scripts)
- Frontend (CRM/UI): `frontend/`

## Como rodar (local)
- Stack principal (recomendado): `./backend/scripts/dev.sh watch`
- CRM (frontend + API): `./frontend/restart_crm.sh --watch-full`
- macOS (sem terminal): dê duplo clique em `start-platform.command`

## Docs
- Mapa do backend: `backend/docs/INDEX.md`
- Política de lockfiles: `backend/docs/LOCKFILES.md`

## Sanity check
- Suite rápida (recomendado): `./backend/scripts/doctor.sh`
