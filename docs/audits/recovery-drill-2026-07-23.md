# Recovery drill — 2026-07-23

Escopo: `skincos-db` (D1), `n8n_runtime` (PostgreSQL), configuração nativa do
runtime e transporte cifrado em R2. Evidência privada, sem conteúdo pessoal ou
segredos: `C:\CodexRuntime\operator\admin\skincos\recovery-drills\20260723T223442Z`.

| Item | Resultado comprovado |
| --- | --- |
| D1 | export de 13 MB; scratch com 58 tabelas, 57 contagens consultáveis idênticas (`_cf_KV` é reservada), zero violações de FK, 16 migrations e leitura de Inventory; re-export SHA-256 idêntico. |
| D1 a partir do backup cifrado | download R2, decriptação, criação/import em scratch e leitura de migrations concluídos em **18,203 s**; 19.096 queries importadas. |
| PostgreSQL | `pg_dump` online de 91 MB sem parar Orb; restore de 58 tabelas em scratch em **16,170 s**; contagens e checksums lógicos idênticos e leitura de workflows/executions/credentials aprovada. |
| Configuração/R2 | arquivo de `/etc/skincos` e units selecionadas cifrado com AES-256, enviado/recuperado no R2 de staging; SHA-256 do arquivo restaurado idêntico e conteúdo do tar legível. |
| Limitação D1 | `PRAGMA integrity_check` é bloqueado pelo provedor (`SQLITE_AUTH`); o drill usou `foreign_key_check`, esquema, contagens, checksum de export e leitura funcional. |
| Limpeza | os dois scratch D1 e o scratch PostgreSQL foram removidos; SQL, dump, SQLite e chaves temporárias em texto claro foram removidos. |

Na observação de RPO às `2026-07-24T01:53:33Z`, o snapshot D1 tinha 1.083 s,
o dump PostgreSQL 396 s e o archive de configuração 146 s. Esses números são
observações do exercício, não SLOs de produção.

## Decisão

O exercício satisfaz prova técnica local/same-provider de backup, restore,
checksum e teste funcional para os escopos acima. Ele **não** satisfaz a
política empresarial de offsite: `skincos-backups-staging` pertence à mesma
conta Cloudflare e a chave está protegida apenas por DPAPI local, sem escrow
externo. Por isso não há módulo promovido e o gate de maturidade permanece
fechado.

## P0 para fechar o gate

1. Selecionar e provisionar cofre em fornecedor distinto, com retenção
   imutável e conta empresarial do Skincos.
2. Criar role de gravação limitada ao prefixo de backup, separada das roles de
   deploy e restore, e registrar seus owners.
3. Guardar a chave de recuperação em KMS/Vault externo com escrow break-glass;
   a DPAPI local é apenas camada transitória.
4. Repetir o exercício recuperando D1, PostgreSQL, R2 e configuração desse
   cofre externo e anexar `recoveryProof` ao módulo candidato.
