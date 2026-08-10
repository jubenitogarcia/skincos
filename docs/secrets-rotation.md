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
- `GITLEAKS_LICENSE` (opcional)
- `SEMGREP_APP_TOKEN` (opcional)

### Cloudflare (Workers/Pages env/secret)
- `SESSION_SECRET`
- `MIGRATION_TOKEN`
- `INTEGRATIONS_ENCRYPTION_SECRET`
- `SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET` — active normal coordination custody.
- `SKINCOS_GLOBAL_COORDINATION_PREVIOUS_KEY` — time-bounded overlap key during rotation.
- `SKINCOS_GLOBAL_COORDINATION_RECOVERY_SECRET` — separate break-glass custody; never reuse the normal key.
NOTE: Sheets credentials were removed (Insumos is D1-only). Do not re-add.

### CRM API / Infra
- Credenciais do lifecycle nativo, mantidas fora do GitHub e documentadas em `docs/runbooks/lifecycle-runtime-cutover.md`
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

### Coordenação global: rotação de chave e fencing

O contrato normal usa `SKINCOS_GLOBAL_COORDINATION_KEY_ID` como variável ativa e
`SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET` como sua custódia. A rotação é uma
operação coordenada, não uma troca unilateral no Worker:

1. Criar a nova chave fora do repositório e configurar o secret normal ativo.
2. Publicar primeiro `SKINCOS_GLOBAL_COORDINATION_PREVIOUS_KEY` e sua variável
   de expiração curta; manter `SKINCOS_GLOBAL_COORDINATION_KEY_ID` no valor
   anterior durante a janela de compatibilidade.
3. Fazer deploy do coordination plane, validar `/v1/readyz`, e confirmar que o
   readback assinado contém `protocol=epoch-fence-v1`, `keyId` e um
   `authorityEpoch` inteiro.
4. Alterar a variável ativa para o novo key ID, atualizar os clientes/actions e
   fazer um novo deploy. Os leases emitidos carregam `authorityKeyId` e
   `authorityEpoch`; provas sem ambos são rejeitadas depois da transição.
5. Após o TTL máximo dos leases e a janela de overlap, remover a chave anterior,
   apagar sua variável de expiração e repetir a readiness/readback. Se houver
   dúvida sobre a autoridade, interromper mutações e usar somente o workflow
   `recover-global-coordinator.yml` com versão incumbent registrada e
   confirmação exata; o workflow aplica fencing de epoch antes de qualquer
   nova aquisição.

O recovery secret precisa ser provisionado separadamente em cada environment e
não é aceito pelo endpoint normal. A operação de recovery é limitada a uma
versão conhecida, uma tentativa e um `recovery_id` idempotente; estado saudável,
versão desconhecida, epoch divergente ou probe ambíguo falham fechados.

### Backend / CRM API (SSH)
1. Gerar nova chave SSH.
2. Atualizar `authorized_keys` no servidor.
3. Atualizar `CRM_API_SSH_KEY` (GitHub).
4. Executar o procedimento de promoção nativa; não criar uma via SSH pelo GitHub Actions.

## Medidas de segurança recomendadas
- Escopo mínimo em tokens (Cloudflare/GitHub).
- Evitar segredos em `.env` versionados.
- Rotação documentada em changelog interno.
- Validar sessão/login após mudança de `SESSION_SECRET`.

## Notas
- Para exceções conhecidas, veja `docs/security-exceptions.md`.
- Variables relacionadas a alerting devem permanecer em modo opt-in:
  - `ENABLE_CLOUDFLARE_ALERTING_APPLY=true` somente se quiser execução agendada.
  - `CLOUDFLARE_ALERT_ENABLE_EMAILS=true` somente se quiser destinos por e-mail.
