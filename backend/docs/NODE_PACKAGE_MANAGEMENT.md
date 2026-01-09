# Node Package Management (backend)

O backend contém múltiplos subprojetos Node com gerenciadores diferentes.

## Opção A (recomendada): usar `backend/scripts/dev.sh`
O `dev.sh` já sabe como iniciar serviços sem depender de um “workspace global”.

## Opção A2 (recomendada): bootstrap por módulo
Para evitar instalar com o gerenciador errado (e criar lockfiles indesejados), use:
```bash
./backend/scripts/bootstrap.sh --core
```

Política de lockfiles: `backend/docs/LOCKFILES.md`.

## Opção B (opt-in): pnpm workspace do backend
Existe um workspace pnpm em `backend/` para unificar apenas os projetos simples (sem workspaces aninhados):
- `backend/apps/crm-api/`
- `backend/apps/instagram/module/`
- `backend/apps/whatsapp/official-module/`
- `backend/apps/whatsapp/official/`

Uso:
```bash
corepack enable
cd backend
pnpm -r install
```

### Projetos que permanecem independentes
- `backend/apps/agent-zero/` (Nx + npm workspaces)
- `backend/apps/actual-server/` (yarn@4)
- `backend/apps/whatsapp/gateway/` (turbo + pnpm workspace próprio)
- `backend/apps/whatsapp/chat-module/` (npm; pacotes em `whatsapp-{core,api,ui}`)
