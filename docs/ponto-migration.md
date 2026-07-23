# Migração do Controle de Ponto para D1

## Fonte e destino

O arquivo legado `ponto_store.v2.json` é aceito apenas pelo importador em `workforce/timekeeping/scripts/import-ponto-json.mjs`. A fonte operacional definitiva é o D1 `skincos-timekeeping`; não existe dual-write nem fallback de escrita para JSON.

As migrations reproduzíveis ficam em `workforce/timekeeping/migrations`:

- `0001_timekeeping.sql`: identidade, vínculos temporais, regras, dispositivos, credenciais, biometria, eventos append-only, correções, fechamentos, auditoria e nonces;
- `0005_employee_profiles.sql`: extensão 1:1 do funcionário canônico, perfil de RH, dados privados cifrados e identificação legal de unidade;
- `0002_operations.sql`: unidades, Escala, feriados, ausências, bloqueio de PIN, snapshots, controle de importação e conflitos de identidade;
- `0003_audit_chain.sql`: cabeça e triggers da cadeia imutável de auditoria.
- `0004_period_guards.sql`: data de trabalho indexada e trava transacional de dias em fechamento/fechados.

## Validação e importação local

```bash
cd workforce/timekeeping
npx --yes wrangler@4.112.0 d1 migrations apply skincos-timekeeping --local --config wrangler.toml
cd ../..
node workforce/timekeeping/scripts/import-ponto-json.mjs \
  --source workforce/timekeeping/fixtures/ponto_store.synthetic.json \
  --dry-run
node workforce/timekeeping/scripts/import-ponto-json.mjs \
  --source <caminho-privado>/ponto_store.v2.json \
  --apply \
  --database skincos-timekeeping \
  --backup <caminho-privado>/ponto-before-import.checkpoint \
  --config workforce/timekeeping/wrangler.toml
```

O `dry-run` valida versão e arrays obrigatórios, referências, datas, tipos, duplicidades e imprime apenas contagens/checksum. PIN, hash legado, template e vetor biométrico nunca são impressos. PINs legados em scrypt são sinalizados para redefinição; não são convertidos sem o PIN original.

Templates biométricos só são migrados quando `PONTO_LEGACY_TEMPLATES_KEY` e `PONTO_TEMPLATES_KEY` estão disponíveis no ambiente privado. O importador decifra o envelope legado e cifra novamente em A256GCM; sem as chaves, preserva o funcionário e reporta a quantidade pendente, sem importar template ilegível.

## Idempotência, conflitos e reconciliação

O checksum SHA-256 da fonte identifica `timekeeping_migration_runs`. A mesma fonte já aplicada é recusada antes do backup/escrita. IDs legados permanecem estáveis e também recebem alias `PONTO_V2`. Emails duplicados não são fundidos: ficam sem login canônico até resolução humana em `workforce_identity_conflicts`.

Após aplicação, compare `source_counts_json`, `result_counts_json` e as contagens das tabelas. O fixture sintético esperado é 1 funcionário e 2 eventos.

## Backup e rollback

No D1 local, o importador copia SQLite, WAL e SHM inativos para o diretório privado informado e gera um rollback SQL transacional. Exemplo:

```bash
node workforce/timekeeping/scripts/import-ponto-json.mjs \
  --rollback-run ponto-json:<checksum-prefixo> \
  --database skincos-timekeeping \
  --backup <caminho-privado>/ponto-before-import.checkpoint.rollback-<checksum>.sql \
  --config workforce/timekeeping/wrangler.toml
```

Em D1 remoto, informe também `--remote --database-id <uuid> --confirm-production`. O importador exige `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` e `PONTO_IMPORT_PRODUCTION_CONFIRM=<checksum>`, exporta o D1 e usa o protocolo oficial de importação (init, upload com ETag, ingestão e polling). Valide esse fluxo e a restauração primeiro no D1 de staging.
