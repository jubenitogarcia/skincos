# Lockfiles (Node) — política do repo

Objetivo: evitar “instalar com o gerenciador errado” e gerar lockfiles conflitantes (ex.: `package-lock.json` dentro de um projeto pnpm).

## Regra prática
- Use `./backend/scripts/bootstrap.sh` para instalar por módulo (ele escolhe `npm`/`pnpm`/`yarn` automaticamente).
- Use `corepack enable` para garantir `pnpm`/`yarn` na máquina.

## Onde cada gerenciador é esperado
- pnpm: projetos listados em `backend/pnpm-workspace.yaml` + `backend/apps/whatsapp/gateway/`
- yarn: `backend/apps/actual-server/`
- npm: `backend/apps/agent-zero/` (Nx/workspaces), `backend/apps/whatsapp/chat-module/*` e outros que declararem `package-lock.json`

## Sinais de problema
- Um mesmo diretório contendo mais de um lockfile:
  - `pnpm-lock.yaml` + `package-lock.json`
  - `yarn.lock` + `package-lock.json`
  - etc.

Rodar `./backend/scripts/test.sh repo-health` mostra alertas (não bloqueia).
