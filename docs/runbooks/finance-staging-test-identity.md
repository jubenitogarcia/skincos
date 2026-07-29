# Identidade técnica do Financeiro em staging

## Identidade e owner

`finance-staging-smoke` é a identidade sintética exclusiva de staging para o smoke e canary Financeiro. Ela é propriedade de `@skincos/finance`; `admin` é o operador responsável pela execução, rotação e teardown. `finance-staging-monitor` permanece somente como identidade `viewer` do monitor e nunca é reutilizada pelo smoke. A identidade usa o login real `POST /insumos/auth/login` e a sessão assinada consumida pelo gateway em `/finance/*`.

- bancos: conta somente em `skincos-db-staging` e grant somente em `skincos-finance-staging`; nunca consultar ou escrever os equivalentes produtivos;
- e-mail sintético: `finance-staging-smoke@staging.invalid`;
- papel: `CONSULTOR`;
- módulos: somente `finance`;
- unidade e grant: somente `finance-scope-novo-hamburgo`, permissão `operator`, o mínimo necessário para importar e desfazer;
- pessoal, BarraShoppingSul, administrador e qualquer mutação fora da importação/compensação sintética controlada: negados;
- a flag `finance_settings.module_enabled` permanece `false` fora de uma janela de smoke aprovada.

A senha não fica no Git, em secret de produção, cookie ou sessão compartilhada. A credencial atual fica cifrada por DPAPI no runtime privado do operador. Cookies emitidos pelo login são host-only para `api-staging.skincos.com.br` e não devem ser enviados a nenhuma origem de produção.

O segredo fica somente no environment GitHub `staging` como
`FINANCE_SMOKE_PASSWORD`; os nomes não secretos necessários pela jornada usam
o prefixo `FINANCE_SMOKE_` e nunca têm fallback de repositório ou produção. O
workflow `finance-staging-canary.yml` fixa username e escopo e sempre restaura
`module_enabled=false` e o grant pré-existente. Expiração operacional máxima:
sete dias; renovar exige rotação e novo registro de evidência. Ao encerrar o
marco, execute `revoke` e remova os valores `FINANCE_SMOKE_*` que não forem
necessários para outro exercício aprovado.

O workflow manual `finance-staging-smoke-identity.yml` é o caminho
reproduzível para `provision`, `rotate` e `revoke`. Ele só usa o environment
`staging`, exige confirmação explícita, verifica um único ator ativo antes de
rotacionar e apaga os SQL efêmeros do runner sem publicá-los como artefato.

## Criação

1. Confirme os alvos `skincos-db-staging` e `skincos-finance-staging` e confirme que `finance_settings.module_enabled=false` antes de escrever.
2. Gere uma senha aleatória de ao menos 24 caracteres e mantenha-a apenas no cofre/armazenamento privado do operador.
3. Gere SQL em arquivo privado; o comando não se conecta à Cloudflare nem imprime senha/hash:

```powershell
$env:FINANCE_SMOKE_IDENTITY_ACK = '1'
$env:FINANCE_SMOKE_PASSWORD = '<segredo privado>'
node .\finance\scripts\staging-smoke-identity-sql.mjs provision --expires-at '<UTC ISO-8601>' --core-output C:\CodexRuntime\operator\admin\skincos\finance-staging-smoke\core-provision.sql --finance-output C:\CodexRuntime\operator\admin\skincos\finance-staging-smoke\finance-provision.sql
```

4. Execute exclusivamente contra staging, valide o login real e apague o SQL após registrar a evidência privada:

```bash
npx wrangler d1 execute skincos-db-staging --remote --file /mnt/c/CodexRuntime/operator/admin/skincos/finance-staging-smoke/core-provision.sql
npx wrangler d1 execute skincos-finance-staging --remote --file /mnt/c/CodexRuntime/operator/admin/skincos/finance-staging-smoke/finance-provision.sql
```

Se a segunda inserção falhar, execute imediatamente `revoke` abaixo. Não ligue a feature flag como parte da criação.

## Rotação e revogação

Rotação exige nova senha privada e incrementa `session_version`, invalidando todas as sessões anteriores:

```powershell
$env:FINANCE_SMOKE_IDENTITY_ACK = '1'
$env:FINANCE_SMOKE_PASSWORD = '<nova senha privada>'
node .\finance\scripts\staging-smoke-identity-sql.mjs rotate --expires-at '<UTC ISO-8601>' --core-output C:\CodexRuntime\operator\admin\skincos\finance-staging-smoke\core-rotate.sql --finance-output C:\CodexRuntime\operator\admin\skincos\finance-staging-smoke\finance-rotate.sql
```

Revogação é imediata: desativa a conta, incrementa `session_version` e remove todos os grants Financeiro. Não requer senha.

```powershell
$env:FINANCE_SMOKE_IDENTITY_ACK = '1'
node .\finance\scripts\staging-smoke-identity-sql.mjs revoke --expires-at '<UTC ISO-8601>' --core-output C:\CodexRuntime\operator\admin\skincos\finance-staging-smoke\core-revoke.sql --finance-output C:\CodexRuntime\operator\admin\skincos\finance-staging-smoke\finance-revoke.sql
```

Execute cada arquivo somente no D1 indicado. Depois confirme que login retorna `403`, o bootstrap não possui grants e `module_enabled` permanece `false`.

## Evidência mínima

Registrar somente no runtime privado: horário, SHA, alvo lógico, resultado do login, escopo/permiteção, resultado do bootstrap e resultado da revogação/rotação. Não registrar senha, hash, cookie, CSRF, e-mail real, URL assinada ou dados financeiros.
