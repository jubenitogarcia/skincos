# Política empresarial de backup e restauração

O contrato executável está em [ops/backup/policy.json](../ops/backup/policy.json). Ele cobre D1, PostgreSQL, R2, configurações e estado operacional, com RPO, RTO, retenção, owner, criptografia, destino offsite e teste de restore por classe.

## Regras obrigatórias

- A cópia primária nunca é a única cópia: toda classe tem uma réplica `age` criptografada em bucket S3-compatível controlado pelo operador e fora da conta Cloudflare e do host PostgreSQL.
- Backups e evidências ficam fora do repositório: `C:/CodexRuntime/operator/admin/skincos/evidence/restore-drills` e o destino offsite privado.
- Restore é sempre primeiro em `scratch`/`isolated`; produção nunca é destino de um drill. Restauração produtiva exige incidente registrado, owner, checkpoint atual e aprovação explícita.
- Dados, dumps e arquivos de configuração contendo segredos não entram em GitHub Actions artifacts. O artifact contém apenas o manifesto de evidência sem segredos.
- Migrations aditivas permanecem após rollback de artefato. A recuperação de dados usa novo procedimento auditável, não um `down` destrutivo.

## Automação e evidência

O workflow [backup-restore-drill.yml](../.github/workflows/backup-restore-drill.yml) roda mensalmente quando `ENABLE_BACKUP_RESTORE_DRILL=true` ou sob despacho manual com confirmação literal. Ele exige que `BACKUP_RESTORE_DRILL_COMMAND` produza um manifesto no caminho `$EVIDENCE_FILE`; o validador rejeita destino de produção, checksum ausente ou restore não verificado. A evidência fica retida por 24 meses e a cópia canônica permanece no runtime privado/offsite.

Configuração externa mínima: `OFFSITE_BACKUP_TARGET`, `OFFSITE_BACKUP_AGE_RECIPIENT`, credenciais privadas do destino e um `BACKUP_RESTORE_DRILL_COMMAND` que exporte o snapshot, restaure em scratch, compare dados e gere o manifesto. O comando deve usar roles de backup/restore separadas e nunca imprimir URLs, dados ou segredos.

## Restauração produtiva

1. Declarar incidente, congelar a escrita do domínio e registrar versão/snapshot/checksum.
2. Restaurar e validar em scratch; comparar schema, contagens, checksums, auditoria e smoke do domínio.
3. Obter aprovação explícita; restaurar somente o domínio afetado, reexecutar migrations aditivas e validar o rollback/feature flag.
4. Preservar evidências, causa, RTO/RPO efetivos e follow-up por 24 meses.
