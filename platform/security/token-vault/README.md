# Token Vault Worker

Worker interno para substituir a aba `Credencial` do Google Sheets usada pelo workflow n8n `Token Manager`.

## Endpoints

- `GET /internal/token-vault/health`
- `GET /internal/token-vault/contract`
- `GET /internal/token-vault/v1/tokens?provider=threads|instagram|facebook&active=true`
- `POST /internal/token-vault/v1/tokens`
- `PATCH /internal/token-vault/v1/tokens/:id`

Todos os endpoints exigem `Authorization: Bearer <TOKEN_VAULT_API_TOKEN>`.

## Bindings e secrets

- D1 binding: `TOKEN_VAULT_DB`
- Secret: `TOKEN_VAULT_API_TOKEN`
- Secret: `TOKEN_VAULT_ENCRYPTION_KEY`

Os tokens são gravados em D1 como AES-GCM ciphertext. Logs, auditoria e respostas de PATCH não retornam token em claro.

## Deploy

```bash
wrangler d1 create skincos-token-vault
wrangler d1 create skincos-token-vault-staging
# Copiar os database_id para wrangler.toml.

wrangler d1 migrations apply skincos-token-vault-staging --config wrangler.toml --env staging --remote
wrangler d1 migrations apply skincos-token-vault --config wrangler.toml --remote

node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | wrangler secret put TOKEN_VAULT_API_TOKEN --config wrangler.toml
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | wrangler secret put TOKEN_VAULT_ENCRYPTION_KEY --config wrangler.toml

wrangler deploy --config wrangler.toml --keep-vars
```

## Import inicial

Exporte a aba `Credencial` como CSV e importe pela API, para que o Worker criptografe antes de gravar no D1:

```bash
TOKEN_VAULT_API_TOKEN=... npm run seed:from-csv -- ./credentials.csv
```

O script não imprime tokens; ele reporta apenas provider, conta externa e tamanho mascarado.
