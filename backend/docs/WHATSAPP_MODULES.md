# WhatsApp no monorepo (skincos)

Objetivo: **não perder nenhuma funcionalidade** e, ao mesmo tempo, deixar claro “o que é o quê” no ecossistema WhatsApp.

## Módulos existentes (todos preservados)

- `backend/apps/whatsapp/official-module/` (recomendado como principal)
  - Multi-canal (3001–3009) e rotas como:
    - `/api/channel-manager/system/status`
    - `/whatsapp/:channelId/status`, `/whatsapp/:channelId/qr`, `/whatsapp/:channelId/send-message`
  - Compat (legacy): `/status`, `/qr`, `/qr.html` (canal 1 quando multi-canal estiver ativo)
  - Usa `LocalAuth` (lib em `backend/apps/whatsapp/official/`) e aceita envs:
    - `WHATSAPP_CLIENT_ID`, `WHATSAPP_DATA_PATH`, `WHATSAPP_USER_DATA_DIR`

- `backend/apps/whatsapp/gateway/` (legacy, mas completo)
  - API clássica com `/status`, `/health`, `/qr.html`, scripts e docker-compose.
  - Suporta multi-instância por porta e já aceita envs úteis:
    - `WWJS_AUTH_PATH` (sessão), `PERSIST_DIR` (storage), `WA_CONTEXT_STORE_PATH` (context_store)
    - **Novo:** `WWJS_PROFILE_DIR` (perfil Chrome em `backend/var/` quando `VAR_DIR` está configurado)

- `backend/apps/whatsapp/stub/` (stub simples para fallback em dev)
  - “Stub” simples para fallback em dev (usado pelo `backend/scripts/dev.sh gateway` se o gateway não existir).

- `backend/apps/whatsapp/official/`
  - Biblioteca (whatsapp-web.js) usada pelo `official-module` (não é o “serviço” em si).

## Integração com o CRM (estado atual)

O CRM (`frontend/` + `backend/apps/crm-api/`) já possui:
- Orquestrador e facades que conversam com o WhatsApp via HTTP (ex.: `/api/unified/*`).
- Painéis/Componentes React que chamam o gateway de forma padronizada.

## Padronização de estado (VAR_DIR)

Para evitar acoplamento de estado dentro do código, os scripts do workspace passaram a setar `VAR_DIR` e paths por instância:
- `backend/scripts/dev.sh official` (official-module)
- `backend/scripts/dev.sh gateway` (gateway)

Isso **não remove** funcionalidades; apenas muda o local onde sessões/perfis/cache são gravados quando `VAR_DIR` está configurado.
