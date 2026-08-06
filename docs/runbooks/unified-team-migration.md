# Migração controlada de identidade da equipe

Este runbook prepara a transição de integrantes ativos da Escala para a
identidade canônica `workforce_employee`. Ele não cria contas, não envia
convites e não tenta resolver vínculos por nome, telefone ou e-mail.

## Inventário multi-fonte

Antes do plano específico da Escala, produzir o inventário governado de todas
as fontes com o script `inventory/scripts/unifiedTeamInventoryReport.mjs`:

```text
node inventory/scripts/unifiedTeamInventoryReport.mjs --input <snapshot-privado.json>
```

O snapshot deve conter as listas `crmAccounts`, `crmOnboarding`,
`workforceEmployees`, `escalaProfessionals`, `atendimentoProfessionals` e
`pontoEmployees`. O resultado é somente leitura, tem `fingerprint`, cobertura,
contagens e filas `ready`, `pending`, `conflicts` e `ignored`, sem devolver
nomes, e-mails, telefones ou IDs brutos. Snapshot ausente, ID não explícito,
órfão, duplicidade, funcionário inativo ou divergência de unidade impede a
confirmação automática.

## Fluxo obrigatório

1. Exportar um inventário somente-leitura da Escala para um arquivo privado,
   contendo pelo menos `id` (ou `professionalId`), `status` e
   `workforceEmployeeId` quando já existir.
2. Executar o plano em modo `dry-run`:

   ```text
   node inventory/scripts/unifiedTeamMigrationPlan.mjs --input <inventario.json> --emit-sql
   ```

3. Guardar o `fingerprint` e o relatório fora do repositório. Os itens
   `pending` e `conflicts` precisam de revisão humana; nenhum vínculo implícito
   deve ser convertido em `CONFIRMED`.
4. Antes de qualquer aplicação controlada, obter backup verificável dos bancos
   envolvidos, registrar o fingerprint aprovado e confirmar que a flag
   `UNIFIED_TEAM_ENABLED` permanece desligada fora do ambiente de validação.
5. Aplicar apenas os statements gerados para os itens `ready`, em uma sessão
   com rollback operacional documentado. O SQL usa `INSERT OR IGNORE`, portanto
   a reaplicação do mesmo plano não cria duplicidade; conflitos existentes não
   são sobrescritos.
6. Reexecutar o plano depois da aplicação. O resultado esperado é `noop` para
   os vínculos aplicados, sem aumento de `conflicts` ou `pending`.
7. Somente depois da validação de staging, ativar a flag no preview/ambiente
   autorizado e então coletar os dados faltantes para convites. Convites devem
   ser enviados apenas pelo fluxo de onboarding hospedado e após confirmação
   explícita do relatório.

## Estado operacional da Escala

O cadastro central expõe `scheduleSync` com os estados `NOT_CONFIGURED`,
`PENDING`, `SYNCED`, `FAILED` e `BLOCKED`. A confirmação exige o vínculo
explícito `source=ESCALA` + `source_id` do profissional; nomes semelhantes não
resolvem a identidade. Falhas são persistidas somente como códigos operacionais
sem PII e podem ser repetidas pela rota autenticada
`POST /admin/team/:id/schedule-sync`, sempre com `Idempotency-Key` único.

O preview local mantém o mesmo contrato em armazenamento privado e registra
tentativas, auditoria e telemetria agregada. O botão de nova tentativa só deve
ser habilitado depois que o identificador explícito do profissional estiver
disponível; a Escala continua contingência até a flag ser liberada pelo gate.

## Rollback

O rollback não apaga profissionais, agendas, nomes históricos, auditoria ou
links de revisão. Ele consiste em desligar a flag, impedir convites e usar o
backup/runner de migração aprovado para restaurar somente os registros novos
que tenham sido aplicados e estejam identificados pelo fingerprint. Qualquer
conflito ou divergência interrompe a aplicação e mantém o estado anterior.

O preview local usa fixture sintética e armazenamento privado do runtime; ele
é apropriado para testar edição, suspensão, convite, revogação e preservação
de agenda sem enviar mensagens ou tocar bancos remotos.
