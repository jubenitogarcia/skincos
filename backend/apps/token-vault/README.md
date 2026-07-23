# Token Vault Worker

Worker interno para substituir a aba `Credencial` do Google Sheets usada pelo workflow n8n `Token Manager`.

## Endpoints

- `GET /internal/token-vault/health`
- `GET /internal/token-vault/contract`
- `GET /internal/token-vault/v1/token-metadata?provider=threads|instagram|facebook&active=true`
- `POST /internal/token-vault/v1/token-maintenance/refresh`
- `POST /internal/token-vault/v1/social-publish/operations`
- `GET /internal/token-vault/v1/tokens?provider=threads|instagram|facebook&active=true`
- `POST /internal/token-vault/v1/tokens`
- `PATCH /internal/token-vault/v1/tokens/:id`
- `GET /internal/token-vault/v1/meta-ads-publish/config`
- `POST /internal/token-vault/v1/meta-ads-publish/inventory`
- `POST /internal/token-vault/v1/meta-ads-publish/runs`
- `GET|PATCH /internal/token-vault/v1/meta-ads-publish/runs/:id`
- `POST /internal/token-vault/v1/meta-ads-publish/runs/:id/heartbeat`
- `POST /internal/token-vault/v1/meta-ads-publish/runs/:id/operations`
- `POST /internal/token-vault/v1/meta-ads-publish/runs/:id/events`

As rotas operacionais aceitam `TOKEN_VAULT_N8N_API_TOKEN`. As rotas brutas de
leitura e escrita de tokens exigem `TOKEN_VAULT_API_TOKEN` administrativo.

## Bindings e secrets

- D1 binding: `TOKEN_VAULT_DB`
- Secret: `TOKEN_VAULT_API_TOKEN`
- Secret: `TOKEN_VAULT_N8N_API_TOKEN`
- Secret: `TOKEN_VAULT_ENCRYPTION_KEY`

Os tokens são gravados em D1 como AES-GCM ciphertext. Logs, auditoria e respostas de PATCH não retornam token em claro.

O gateway `meta-ads-publish` resolve o token dentro do Worker. O n8n recebe apenas
`token_id` e metadados de destino. Chamadas Graph aceitam somente ações conhecidas,
mantêm journal e locks no D1 e aplicam reconciliação/compensação para mutações.

Cada linha Facebook usada pelo publish deve incluir uma landing page específica
por grupo criativo em `metadata.meta_ads_publish`:

```json
{
  "landing_pages_by_creative_group": {
    "<creative_group_key>": "https://espacofacial.com/<campanha>"
  }
}
```

O endpoint de configuração valida HTTPS, allowlist, disponibilidade e cadeia de
redirects. Destino final em WhatsApp, mapa ausente ou URL inválida deixa a
configuração `ready=false` antes de qualquer operação na Meta.

O gateway `social-publish` aplica a mesma fronteira para Livia: plataforma,
unidade, metodo, host e path são validados antes de o Worker injetar a credencial.
O endpoint de metadados nunca descriptografa nem devolve tokens.

Estados principais de um run:

- `acquired` / `processing`
- `creatives_ready`
- `staged`
- `meta_completed_drive_pending`
- `completed`
- `rolled_back`
- `reconciliation_required`

## Deploy

```bash
wrangler d1 create skincos-token-vault
wrangler d1 create skincos-token-vault-staging
# Copiar os database_id para wrangler.toml.

wrangler d1 migrations apply skincos-token-vault-staging --config wrangler.toml --env staging --remote
wrangler d1 migrations apply skincos-token-vault --config wrangler.toml --remote

node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | wrangler secret put TOKEN_VAULT_API_TOKEN --config wrangler.toml
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | wrangler secret put TOKEN_VAULT_ENCRYPTION_KEY --config wrangler.toml

# Cria uma versao sem trafego. Valide a Preview URL antes de promover.
npx wrangler versions upload --config wrangler.toml --env="" --keep-vars
```

Não publique este Worker por upload bruto de `/content`: esse caminho pode criar
uma versão sem bindings. Antes do deploy, registre o deployment/version atual;
depois, confirme D1, variáveis e nomes dos secrets, execute os testes read-only e
mantenha o rollback apontando 100% para a versão anterior. Nunca imprima nem
recrie secrets apenas para contornar um deploy sem bindings.

### Autenticacao Wrangler no mini-PC

O plugin Cloudflare do Codex pode consultar recursos, D1 e deployments, mas nao
consegue ler `secret_text` para reconstruir um upload de Worker com seguranca.
Use o Wrangler autenticado no mesmo perfil WSL que fara o deploy, sempre com
`--keep-vars`, mas nao suponha que essa opcao recupera um secret que ja foi
desconectado por uma versao antiga criada via API bruta.

Em PowerShell, `/mnt/c/...` nao e um caminho valido. Execute o comando completo
abaixo, que entra no WSL `admin` antes de chamar o Wrangler:

```powershell
wsl.exe -d Ubuntu-24.04 -- bash -lc 'cd /mnt/c/CodexShared/Worktrees/skincos/admin/<worktree>/backend/apps/token-vault && npx wrangler login --browser=false --callback-host 0.0.0.0'
```

Abra somente o link OAuth impresso por esse processo e mantenha o processo em
execucao ate o retorno para `localhost:8976/oauth/callback`. O parametro `state`
do callback precisa pertencer a essa mesma tentativa: abrir outro `wrangler
login` antes do retorno faz a tentativa original expirar, mesmo que a aprovacao
no navegador tenha sido bem-sucedida.

Antes de qualquer deploy, a verificacao obrigatoria e:

```bash
npx wrangler whoami
npm run deploy
```

O upload cria uma versao sem trafego e informa sua Preview URL. Consulte
`/health` nessa URL sem credencial: `401` significa que o Worker recebeu o
secret de autenticacao; `500` com `missing_worker_secret` significa que a
versao esta incompleta e nao pode ser promovida. Somente apos o preview retornar
`401`, publique essa versao explicitamente com `npm run deploy:promote --
<version-id>@100 --name skincos-token-vault --yes`.

Se `whoami` nao identificar a conta esperada ou o preview retornar `500`,
interrompa o deploy e mantenha/retorne ao ultimo deployment saudavel. Nesse
estado, nem o plugin nem a API conseguem ler os valores dos secrets antigos. A
unica recuperacao segura e localizar a fonte privada original ou, com
autorizacao explicita, rotacionar os secrets e recriptografar os tokens do D1.
Nao use API bruta de versoes como atalho.

## Import inicial

Exporte a aba `Credencial` como CSV e importe pela API, para que o Worker criptografe antes de gravar no D1:

```bash
TOKEN_VAULT_API_TOKEN=... npm run seed:from-csv -- ./credentials.csv
```

O script não imprime tokens; ele reporta apenas provider, conta externa e tamanho mascarado.
