# Secrets & Rotation Playbook

## Objetivo
Garantir que segredos críticos (GitHub, Cloudflare, backend) tenham **escopo mínimo**, **rotação periódica** e **procedimento de emergência** documentado.

## Inventário mínimo (por área)

### GitHub Actions (secrets)
- `GH_TOKEN` (CI submodules)
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ALERTS_API_TOKEN` (alerting/notifications — escopo mínimo, sem permissões de deploy)
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_ALERT_WEBHOOK_URL` (opcional)
- `CRM_API_SSH_HOST`
- `CRM_API_SSH_USER`
- `CRM_API_SSH_KEY`
- `CRM_API_SSH_PORT` (opcional)
- `GITLEAKS_LICENSE` (opcional)
- `SEMGREP_APP_TOKEN` (opcional)

### Cloudflare (Workers/Pages env/secret)
- `SESSION_SECRET`
- `MIGRATION_TOKEN`
- `INTEGRATIONS_ENCRYPTION_SECRET`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `SPREADSHEET_ID`
- `SHEET_ID`

### CRM API / Infra
- Chaves SSH do deploy (mesmas de GitHub)
- Tokens internos de módulos (ex.: `CRM_UNIT_MONITOR_PROXY_TOKEN`, `WEBHOOK_SECRET`)

## Política de rotação

### Frequência recomendada
- **Tokens de deploy (Cloudflare/GH/SSH)**: a cada 90 dias.
- **Segredos de sessão/criptografia** (`SESSION_SECRET`, `INTEGRATIONS_ENCRYPTION_SECRET`): a cada 180 dias.
- **Chaves de integração externa** (Google Service Account, webhooks): a cada 180 dias ou após incidente.

### Evento de rotação imediata
- Vazamento de credencial, acesso indevido, ou alerta confirmado de secret scanning.

## Procedimento (checklist)

### GitHub Actions
1. Gerar novo token com **escopo mínimo** (ex.: `repo` apenas se necessário).
2. Atualizar `Settings → Secrets and variables → Actions`.
3. Invalidar token antigo.
4. Rodar workflow de deploy/CI para validar.

### Cloudflare
1. Gerar novo `CLOUDFLARE_API_TOKEN` com escopos mínimos.
2. Atualizar em `GitHub Actions secrets`.
3. Atualizar secrets/vars no Cloudflare (Workers/Pages).
4. Fazer deploy de teste e validar `/health`.

### Backend / CRM API (SSH)
1. Gerar nova chave SSH.
2. Atualizar `authorized_keys` no servidor.
3. Atualizar `CRM_API_SSH_KEY` (GitHub).
4. Executar workflow `deploy-crm-api`.

## Medidas de segurança recomendadas
- Escopo mínimo em tokens (Cloudflare/GitHub).
- Evitar segredos em `.env` versionados.
- Rotação documentada em changelog interno.
- Validar sessão/login após mudança de `SESSION_SECRET`.

## Notas
- Para exceções conhecidas, veja `docs/security-exceptions.md`.
