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

## Atualização de cofre externo — 2026-07-24

O drill `20260724T0620Z` criou novos exports somente leitura de D1,
PostgreSQL e configuração nativa, cifrou-os com AES-256-CBC + HMAC-SHA-256 e
os enviou a um Google Drive privado. A chave foi criada no runtime privado,
protegida por DPAPI e registrada separadamente como Environment Secret no
GitHub Actions; hashes
e metadados sanitizados estão na evidência privada do operador.

O upload externo e a separação de fornecedor estão comprovados. Em
`20260725T-offsite-restore-current-main`, o cliente com escopo `drive.file`
recuperou o ciphertext D1 do Drive. Os ciphertexts PostgreSQL e configuração
já presentes no runtime privado foram conferidos byte-a-byte contra o
manifesto do mesmo cofre e restaurados no scratch privado; a transferência
fresh desses dois arquivos não foi rebaixada a prova nesta execução porque o
conector raw excede o limite IPC. A verificação HMAC, os três hashes plaintext
e a validação funcional passaram para os arquivos restaurados:

- D1: 58 tabelas, 16 migrations (última `0016_personal_invites.sql`), zero
  violações de FK; Financeiro com 3 scopes, 2 grants, 1 setting, 0 movimentos,
  0 lançamentos e 12 migrations de release.
- PostgreSQL: restore custom dump em banco isolado, 58 tabelas, 43 workflows,
  246 executions e 44 credentials; restore em 25,643 s.
- Configuração: tar legível com 33 entradas e SHA-256 idêntico; o restore
  criptográfico levou 0,479 s (D1 0,637 s).

O scratch e os arquivos plaintext foram destruídos após a validação; resta apenas
`C:\CodexRuntime\operator\admin\skincos\offsite-recovery\20260725T-current-main-offsite-restore-evidence.sanitized.json`.
Isto fecha a prova técnica offsite de D1 e a prova criptográfica/funcional local
dos outros dois payloads; o restore offsite de PostgreSQL/configuração ainda
precisa de uma captura de download auditável para fechar o conjunto. Ela
não é `recoveryProof` do módulo Financeiro: não restaura o bundle/Worker do
Financeiro nem aprova piloto, e `module_enabled` permanece desligado.

O snapshot tinha 76.272,151 s de idade no momento do restore; isso é uma
observação do exercício, não um RPO de produção. Permanece P1 a migração do
cofre para Shared Drive com conta de serviço/owner corporativo e o escrow em KMS
externo ao GitHub; a chave atual está separada como Environment Secret de
`recovery` e protegida por DPAPI no runtime privado.
