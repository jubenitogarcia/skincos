# Identidade técnica do Financeiro em staging

## Identidade e owner

`finance-staging-monitor` é uma identidade sintética, exclusiva de staging e propriedade de `@skincos/finance`; `admin` é o operador responsável pela execução e pela guarda da credencial. Ela usa o login real `POST /insumos/auth/login` e a sessão assinada consumida pelo gateway em `/finance/*`.

- banco: somente `skincos-db-staging`; nunca consultar ou escrever `skincos-db`;
- e-mail sintético: `finance-staging-monitor@staging.invalid`;
- papel: `CONSULTOR`;
- módulos: somente `finance`;
- unidade e grant: somente `finance-scope-novo-hamburgo`, permissão `viewer`;
- pessoal, BarraShoppingSul, administrador, importação e mutações: negados;
- a flag `finance_settings.module_enabled` permanece `false` fora de uma janela de smoke aprovada.

A senha não fica no Git, em secret de produção, cookie ou sessão compartilhada. A credencial atual fica cifrada por DPAPI no runtime privado do operador. Cookies emitidos pelo login são host-only para `api-staging.skincos.com.br` e não devem ser enviados a nenhuma origem de produção.

## Criação

1. Confirme o alvo com `npx wrangler d1 info skincos-db-staging` e confirme que `finance_settings.module_enabled=false` antes de escrever.
2. Gere uma senha aleatória de ao menos 24 caracteres e mantenha-a apenas no cofre/armazenamento privado do operador.
3. Gere SQL em arquivo privado; o comando não se conecta à Cloudflare nem imprime senha/hash:

```powershell
$env:FINANCE_STAGING_IDENTITY_ACK = '1'
$env:FINANCE_STAGING_TEST_PASSWORD = '<segredo privado>'
node .\finance\scripts\staging-test-identity-sql.mjs create --output C:\CodexRuntime\operator\admin\skincos\finance-staging-identity\provision.sql
```

4. Execute exclusivamente contra staging, valide o login real e apague o SQL após registrar a evidência privada:

```bash
npx wrangler d1 execute skincos-db-staging --remote --file /mnt/c/CodexRuntime/operator/admin/skincos/finance-staging-identity/provision.sql
```

Se a segunda inserção falhar, execute imediatamente `revoke` abaixo. Não ligue a feature flag como parte da criação.

## Rotação e revogação

Rotação exige nova senha privada e incrementa `session_version`, invalidando todas as sessões anteriores:

```powershell
$env:FINANCE_STAGING_IDENTITY_ACK = '1'
$env:FINANCE_STAGING_TEST_PASSWORD = '<nova senha privada>'
node .\finance\scripts\staging-test-identity-sql.mjs rotate --output C:\CodexRuntime\operator\admin\skincos\finance-staging-identity\rotate.sql
```

Revogação é imediata: desativa a conta, incrementa `session_version` e remove todos os grants Financeiro. Não requer senha.

```powershell
$env:FINANCE_STAGING_IDENTITY_ACK = '1'
node .\finance\scripts\staging-test-identity-sql.mjs revoke --output C:\CodexRuntime\operator\admin\skincos\finance-staging-identity\revoke.sql
```

Execute o arquivo gerado com o mesmo comando Wrangler restrito a `skincos-db-staging`. Depois confirme que login retorna `403`, o bootstrap não possui grants e `module_enabled` permanece `false`.

## Evidência mínima

Registrar somente no runtime privado: horário, SHA, alvo lógico, resultado do login, escopo/permiteção, resultado do bootstrap e resultado da revogação/rotação. Não registrar senha, hash, cookie, CSRF, e-mail real, URL assinada ou dados financeiros.
