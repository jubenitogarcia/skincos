# Papéis PostgreSQL do staging isolado

O template cria somente papéis `NOLOGIN NOINHERIT`, banco isolado e schemas `identity`, `inventory` e `finance`. Não cria senha, login, pool, grant de produto ou migration de domínio.

Primeiro, valide o plano sem conexão:

```bash
node scripts/staging/postgresql-roles.mjs
```

Na janela aprovada, obtenha a URL administrativa de staging exclusivamente pelo gerenciador de segredos e aplique:

```bash
SKINCOS_STAGING_POSTGRES_APPLY=1 PG_STAGING_ADMIN_URL="$PG_STAGING_ADMIN_URL" \
  node scripts/staging/postgresql-roles.mjs --apply
```

O comando não registra a URL, usuário ou senha. Login roles por serviço devem ser criadas em PRs de cutover próprias, mapeadas ao papel de runtime do domínio e limitadas a TLS, pool e timeouts revisados. Uma mudança de Identity, Inventory ou Financeiro não pode ser aplicada com o mesmo login administrativo.
