# Token Vault Worker

Worker interno para substituir a aba `Credencial` do Google Sheets usada pelo workflow n8n `Token Manager`.

## Endpoints

- `GET /internal/token-vault/health`
- `GET /internal/token-vault/contract`
- `GET /internal/token-vault/v1/tokens?provider=threads|instagram|facebook&active=true`
- `POST /internal/token-vault/v1/tokens`
- `PATCH /internal/token-vault/v1/tokens/:id`
- `POST /internal/token-vault/v1/analytics/operations`

Os endpoints administrativos exigem `Authorization: Bearer <TOKEN_VAULT_API_TOKEN>`.
O endpoint de analytics exige o secret separado
`TOKEN_VAULT_ANALYTICS_API_TOKEN` (administradores continuam podendo operar o
endpoint para diagnóstico controlado).

## Bindings e secrets

- D1 binding: `TOKEN_VAULT_DB`
- Secret: `TOKEN_VAULT_API_TOKEN`
- Secret: `TOKEN_VAULT_ANALYTICS_API_TOKEN` (somente analytics read-only)
- Secret: `TOKEN_VAULT_ENCRYPTION_KEY`
- Variável opcional: `META_GRAPH_VERSION` (default `v20.0`)
- Variável de gate: `INFLUENCER_INTELLIGENCE_ANALYTICS_MODE` (`off` por
  padrão; `shadow` permite requests bounded; `active` exige também a flag
  explícita `INFLUENCER_INTELLIGENCE_ENABLED=true`)

Os tokens são gravados em D1 como AES-GCM ciphertext. Logs, auditoria e respostas de PATCH não retornam token em claro.

## Analytics read-only

`POST /internal/token-vault/v1/analytics/operations` aceita somente o contrato
versionado do Influencer Intelligence. O chamador envia `provider=meta-graph`,
uma operação fechada e um `credential_ref` opaco. O Worker só usa uma
credencial `instagram` ativa com `metadata.analytics_scopes` contendo
`influencer-intelligence`; o token é descriptografado apenas dentro do Worker
e usado em chamadas `GET` fixas ao Meta Graph. Nenhum token, sessão, URL de
credencial, payload bruto, comentário ou ação de escrita atravessa a resposta.

Gaps de permissão/cobertura retornam um envelope `unavailable`; timeouts,
limites, falhas transitórias e respostas inválidas retornam erros estruturados
para o retry/circuit breaker do router. Falha de auditoria encerra a operação
sem resposta de sucesso. O endpoint não substitui o gateway de publicação e
não deve ser usado para follow, like, DM, post, upload ou scraping.

O caminho deve ser configurado primeiro em staging com o secret dedicado. Não
ativar a flag/grant de Influencer Intelligence, importar o workflow Orb ou
aplicar as migrations PostgreSQL como parte da configuração do Worker.

O `health` só fica `ok=true` quando D1, a chave de administração, a chave de
analytics e a chave de criptografia estão presentes. A ausência do secret de
analytics mantém o Worker unhealthy e impede que um deploy parcial pareça
pronto para o transport real.

O modo `off` rejeita o caminho analytics com `analytics_disabled` antes de
descriptografar credenciais ou chamar o Meta Graph. `shadow` é o único modo
esperado para o primeiro smoke controlado; ele não habilita CRM, MCP, Orb ou
unidades systemd. `active` permanece bloqueado até a flag server-side também
estar explicitamente verdadeira.

## Gate operacional de analytics em staging

O secret `TOKEN_VAULT_ANALYTICS_API_TOKEN` deve existir separadamente no
Worker de staging e no arquivo privado do serviço interno. O valor é sempre
fornecido por uma fonte de segredos aprovada via stdin; nunca coloque o valor
em argumento, arquivo, repositório ou evidência:

```bash
# Execute somente em terminal/custódia privada; não cole o valor no comando.
printf '%s' "$TOKEN_VAULT_ANALYTICS_API_TOKEN" | \
  wrangler versions secret put TOKEN_VAULT_ANALYTICS_API_TOKEN \
  --config wrangler.toml --env staging \
  --message "influencer-intelligence:analytics-readonly-staging"

# Retorna apenas nomes/metadados, nunca valores.
wrangler secret list --config wrangler.toml --env staging
wrangler versions list --config wrangler.toml --env staging

# Somente depois de registrar o incumbent, revisar a versão e confirmar o
# rollback, promova a versão retornada pelo comando anterior.
wrangler versions deploy <candidate-version-id>@100% \
  --config wrangler.toml --env staging --yes
```

Antes do deploy, registre a versão incumbent e seu caminho de rollback. Depois
confirme `health` e `contract` com autenticação, e execute somente requests
sintéticos bounded. Um smoke Meta read-only exige uma credencial de staging
explicitamente aprovada, com `provider=instagram` e
`metadata.analytics_scopes=["influencer-intelligence"]`; sem ela o resultado
esperado é `unavailable`, não uma coleta implícita. A flag/grant do módulo, os
units internos e o workflow Orb permanecem desligados durante este gate.

### Bootstrap selado da primeira credencial Meta

Quando o D1 de staging ainda não contém credencial `instagram`, o workflow
manual `Influencer Intelligence Staging Shadow` pode selar exatamente uma
credencial dedicada no Vault. O operador configura os valores somente como
**environment secrets** do ambiente GitHub `staging`, nunca em chat, URL,
terminal, commit, artefato ou variável de repositório:

- `INFLUENCER_INTELLIGENCE_META_GRAPH_TOKEN`: token long-lived de Login do
  Facebook/Business Login, dedicado ao gate. Não reutilizar `META_ACCESS_TOKEN`
  de CAPI.
- `INFLUENCER_INTELLIGENCE_META_GRAPH_INSTAGRAM_ACCOUNT_ID`: identificador
  numérico da conta Instagram profissional conectada à Página que autorizou o
  token.
- `INFLUENCER_INTELLIGENCE_SHADOW_CREATOR_HANDLE`: único `@handle` aprovado
  para a jornada posterior `resolve_creator` e `get_profile`.

Para este smoke, o token deve ser de um operador que tem acesso à Página e à
conta profissional conectada, com os escopos de leitura aprovados no app (em
particular `instagram_basic`, `pages_show_list`, `pages_read_engagement` e,
quando disponível, `instagram_manage_insights` e `business_management`). Não
conceder escopos de publicação, mensagens, follow, like ou comentários para
esse gate.

O endpoint interno de bootstrap não aparece no contrato normal e só aceita
`POST /internal/token-vault/v1/analytics/staging-bootstrap` autenticado por um
segredo efêmero distinto, criado pelo job. Ele funciona somente quando
`ENVIRONMENT=staging`, modo analytics `shadow` e
`INFLUENCER_INTELLIGENCE_ENABLED=false`. Aceita um schema fechado com token,
referência opaca e ID profissional; não chama Meta, não expõe nenhum desses
valores, não atualiza/revoga credenciais e grava a credencial AES-GCM e a
auditoria no mesmo batch D1. Se qualquer credencial Instagram já existir, o
endpoint retorna `bootstrap_already_sealed` ou
`bootstrap_existing_credential`; não há overwrite ou fallback.

O segredo efêmero continua sem capacidade de leitura ou escrita depois do
primeiro selo: ele só enxerga esse endpoint e o endpoint passa a recusar todas
as chamadas quando existe uma credencial Instagram. Ele também torna a
configuração inválida fora de `staging` + `shadow` com o módulo desabilitado,
exigindo remoção/rotação explícita antes de qualquer promoção futura. A única chamada Graph do gate é
feita depois pelo router Meta-only, com timeout de 12 s e retry seguro limitado.

## Deploy

```bash
wrangler d1 create skincos-token-vault
wrangler d1 create skincos-token-vault-staging
# Copiar os database_id para wrangler.toml.

wrangler d1 migrations apply skincos-token-vault-staging --config wrangler.toml --env staging --remote
wrangler d1 migrations apply skincos-token-vault --config wrangler.toml --remote

node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | wrangler secret put TOKEN_VAULT_API_TOKEN --config wrangler.toml
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | wrangler secret put TOKEN_VAULT_ENCRYPTION_KEY --config wrangler.toml

# Produção só depois do gate de staging e de uma promoção explicitamente aprovada.
wrangler deploy --config wrangler.toml --keep-vars
```

## Import inicial

Exporte a aba `Credencial` como CSV e importe pela API, para que o Worker criptografe antes de gravar no D1:

```bash
TOKEN_VAULT_API_TOKEN=... npm run seed:from-csv -- ./credentials.csv
```

O script não imprime tokens; ele reporta apenas provider, conta externa e tamanho mascarado.
