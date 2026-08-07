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

Vínculos novos entram como `PENDING_REVIEW` quando não vieram de uma resposta
confirmada da origem. A decisão humana usa
`POST /admin/team/:id/links/:linkId/review` com `CONFIRMED` ou `REJECTED`;
rejeições exigem motivo, a confirmação é auditada e um vínculo confirmado não
é rebaixado neste fluxo. Isso fecha a fila de exceções sem permitir que a
interface resolva identidade por nome.

Edições parciais preservam os dados operacionais já persistidos da Escala. A
alteração de telefone recalcula o hash enviado ao Workforce e não expõe o
telefone pessoal nas respostas do cadastro.

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

## Migrações e validação de staging

As migrações devem ser aplicadas pelo runner versionado do Worker de Inventário,
nunca por SQL manual no console do D1. A sequência esperada é `0024` seguida de
`0025`; a segunda adiciona o fingerprint completo da requisição de onboarding e
fecha a possibilidade de reutilizar uma chave de idempotência com outro payload.

Antes da aplicação, registrar no checkpoint privado:

- release/commit efetivamente publicado no Worker e no console;
- estado de `d1_migrations`, contagens das tabelas afetadas e export/backup
  verificável do banco de staging;
- fingerprint do inventário aprovado e estado da flag
  `UNIFIED_TEAM_ENABLED`.

Depois da aplicação, confirmar que os dois tags aparecem em `d1_migrations`,
que a coluna `request_fingerprint` e seu índice existem e que a reaplicação é
`noop`. A API só pode ser exercitada depois dessa confirmação. O primeiro
exercício deve usar identidade sintética, unidade autorizada e destinatário de
teste controlado; registrar resposta, auditoria e telemetria agregada, sem
armazenar senha, token ou conteúdo de mensagem.

O gate de staging é encerrado somente quando a jornada sintética comprovar:

1. cadastro idempotente e rejeição de payload divergente com a mesma chave;
2. convite único, criação de senha pelo próprio usuário e login por usuário e
   e-mail corporativo;
3. edição, desativação, revogação e preservação da agenda;
4. acesso permitido para Gestor/Gerente na unidade autorizada e bloqueio de
   Consultor, de unidade externa e de vínculo implícito;
5. sincronização da Escala com vínculo explícito e Atendimento/Ponto sem
   associação por semelhança de nome.

Qualquer ausência de binding, release, destinatário de teste ou evidência de
backup mantém a flag desligada e a Escala em contingência. O relatório deve
separar claramente `local`, `staging` e `produção`; sucesso de um ambiente não
é evidência de publicação ou convite nos demais.
