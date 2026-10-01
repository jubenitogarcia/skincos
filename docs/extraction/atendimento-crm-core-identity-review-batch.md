# Lote revisado de identidade de Atendimento para CRM Core

Este contrato prepara a única entrada admissível para a futura materialização
de links `attendanceId` para `canonicalClientId`. Ele é separado do fluxo
legado de revisão de nomes: aceita apenas UUIDs, digest SHA-256 de evidência e
uma decisão explícita do owner `atendimento`.

O arquivo de contrato é
[`atendimento-crm-core-identity-review-batch.schema.json`](atendimento-crm-core-identity-review-batch.schema.json).
O único arquivo versionado de exemplo é
[`atendimento-crm-core-identity-review-batch.synthetic.json`](atendimento-crm-core-identity-review-batch.synthetic.json),
que contém valores sintéticos e nunca representa clientes, atendimentos ou
aprovações reais.

## Formato permitido

Cada lote precisa ter `contract`, `batchId`, `runId`, `review` e `links`, sem
campos adicionais. A revisão declara apenas um identificador opaco de chave,
não um nome ou e-mail. Cada link contém exatamente:

```text
attendanceId, canonicalClientId, status, method, evidenceDigest, sourceRevision
```

Nesta etapa, somente `status: "confirmed"` e
`method: "reviewed_reconciliation"` são aceitos. Links ambíguos ou não
confirmados ficam fora do lote; não podem ser aproximados por nome, apelido,
telefone, e-mail, texto de justificativa ou evidência em claro.

## Verificação local sem escrita

No worktree do monorepo, use a ponte WSL tipada para validar um arquivo:

```powershell
$worktree = 'C:\CodexShared\Worktrees\skincos\admin\crm-identity-review-batch-20260915'
& "$worktree\scripts\invoke-skincos-wsl.ps1" `
  -ProjectRoot $worktree `
  -NpmScript 'atendimento:crm-core:identity-review-batch:verify' `
  -Argument @('--batch', 'docs/extraction/atendimento-crm-core-identity-review-batch.synthetic.json')
```

O leitor só devolve contrato, quantidade de links e um digest determinístico.
Ele não imprime UUIDs, não abre conexão de banco, não carrega variáveis de
ambiente, não chama o writer e não tem modo `--apply`.

Um lote real deve permanecer no repositório privado de custódia do owner de
Atendimento, nunca no Git ou em uma worktree compartilhada. O digest detecta
mudança de conteúdo, mas não comprova sozinho que uma pessoa revisou ou
autorizou o lote.

## Próximo gate, depois de uma revisão real

Uma vez que um lote real esteja disponível e seja validado, ele ainda não
autoriza backfill, rota, deploy ou corte. O passo seguinte continua sendo uma
execução externa e opt-in pelo principal mínimo
`crm_core_identity_materializer`, com preflight de staging, recibo independente
e leitura de volta. A projeção por domínio, a troca de publisher e a aposentadoria
do legado continuam exigindo seus recibos de produção separados.
