# Candidato de custódia de fonte de produção para Atendimento -> CRM Core

## Finalidade e limite

Este runbook descreve a única preparação adicionada pelo módulo
`crm/api/server/atendimento/confirmedProjectionProductionCandidateCustody.js`.
Ele valida uma cadeia curta de evidências sanitizadas antes de um futuro helper
root-owned considerar uma fonte de produção. Ele não executa uma leitura,
escrita, deploy, migração, entrega, rota, flag ou aposentadoria de runtime.

O resultado sempre declara:

```text
sourceReadAllowed=false
deliveryAllowed=false
productionMutationAllowed=false
publicRouteMutationAllowed=false
legacyPublisherMutationAllowed=false
```

Logo, esse candidato não muda a admissão de backfill por domínio, não torna o
CRM Core de produção elegível e não substitui o runbook de staging existente.

## Entradas que o helper root-owned precisa fixar

O chamador root-owned cria o verificador com uma `KeyObject` pública Ed25519
previamente pinada em sua política privada. A chave não vem do envelope, de
GitHub, de variável de ambiente ou do checkout. Para uma mesma execução, o
verificador recebe a hora atual e exatamente cinco envelopes assinados, com
validade máxima de 15 minutos e na ordem abaixo:

1. `source-identity`: SHA fonte, banco
   `skincos_clientes_production`, principal e sessão
   `crm_core_projection_exporter`, transação `repeatable-read-read-only`,
   semântica v5 e somente as quatro relações de Atendimento permitidas.
2. `cursor`: o digest do cursor derivado do snapshot, do watermark e do
   manifesto opaco do baseline.
3. `checkpoint`: digest de checkpoint custodiado em estado `sealed` e ligado
   às duas evidências anteriores.
4. `reconciliation`: readback verificado do mesmo baseline, mesmo cursor,
   checkpoint e artefato **de staging** do Core.
5. `rollback`: alvo de retorno distinto, smoke com digest e estratégia fixa
   `disable-ingestion-preserve-ledger`.

Cada envelope carrega somente metadados, SHA-256, contagens, watermark, alvo e
flags de privacidade `false`. O módulo rejeita credenciais, PII, identificadores
brutos, qualquer domínio diferente de `atendimento-client-memberships`, qualquer
relação Finance e qualquer alvo Core que não seja staging. A assinatura é sobre
o JSON canônico retornado por
`canonicalAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence(...)`.

## Dependências que continuam externas

O candidato só pode ser apresentado após existir um baseline v2 `delta-ready`:
ele já exige recibos Core aceitos/idempotentes e readback que coincidem com
snapshot, manifesto e watermark. A captura real continua sendo uma operação
posterior, sob custódia privada, com principal/grants de menor privilégio,
checkpoint privado, lease/fencing de `release:atendimento` e rollback
verificável. O executor de baseline existente não é chamado por este módulo,
pois materializa memberships e outbox no banco de origem.

Antes de qualquer produção, os requisitos pendentes continuam independentes:

- candidato Core/Identity/gateway com versões imutáveis e recibo externo;
- admissão específica de produção, sem mudar o plano de staging por edição;
- principal de leitura e snapshot canônico atestados pelo owner;
- switch de publisher único, retirada do legado e readback independente;
- plano de rollback executável que preserve ledger e evidência.

Nenhum desses fatos é inferido pela existência do candidato ou por um teste
local. O artefato de candidato é apenas uma ligação verificável entre as
evidências que o helper root-owned deverá revalidar no momento da operação.
