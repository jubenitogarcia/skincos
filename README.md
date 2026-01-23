# skincos

Plataforma interna (local) para automações e operações da clínica.

## Estrutura (source of truth)
- Backend: `backend/` (apps, automations, libs, tools, scripts)
- Frontend (CRM/UI): `frontend/`

## Como rodar (local)
- Stack principal (recomendado): `./backend/scripts/dev.sh watch`
- CRM (frontend + API): `./frontend/restart_crm.sh --watch-full`
- macOS (sem terminal): dê duplo clique em `start-platform.command`

## Módulo Ponto (face + PIN)
- Backend (CRM API): expõe endpoints em `/api/ponto/*` e persiste em `backend/var/core/` (ignorado do git).
- Config (env, obrigatório): `PONTO_ADMIN_TOKEN` (token master para rotas `/api/ponto/admin/*`).
- Config (env, opcional): `PONTO_TEMPLATES_KEY` (AES-256-GCM p/ templates faciais em repouso), `PONTO_AUDIT_HMAC_KEY` (HMAC da trilha de auditoria), `PONTO_FACE_THRESHOLD`, `PONTO_PUNCH_COOLDOWN_SECONDS`.
- Frontend: baixe os modelos faciais para `frontend/public/face-models/` com `cd frontend && npm run fetch-face-models`.
- Fluxo recomendado: Admin cria funcionários (PIN + cadastro facial) → Admin cria token do dispositivo por unidade → telefone da clínica usa aba “Ponto” em “Dispositivo (relógio)” com o token.

## Docs
- Mapa do backend: `backend/docs/INDEX.md`
- Política de lockfiles: `backend/docs/LOCKFILES.md`

## Sanity check
- Suite rápida (recomendado): `./backend/scripts/doctor.sh`
