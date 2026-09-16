# Executor de custódia do CRM Core em produção

`scripts/crm/crm-production-custody-executor.mjs` é a ponte local, separada de
GitHub Actions, para um lote de identidade revisado pelo owner de Atendimento.
Ela aceita exclusivamente o contrato
`atendimento/crm-core/identity-review-batch/v1`: cada vínculo contém UUIDs,
uma revisão aprovada e um digest de evidência. Nomes, telefone, e-mail,
payloads e segredos são rejeitados antes de qualquer conexão.

O executor não descobre vínculos e não copia dados de outros domínios. A
unidade é informada explicitamente pelo operador e limitada a
`barra-shopping-sul` ou `novo-hamburgo`; o vínculo só pode ser preparado quando
o lote já tiver sido revisado fora do Git.

## Modos

`plan` valida o lote e produz somente um resumo determinístico. `preflight`
abre uma transação PostgreSQL somente leitura com o principal
`crm_core_identity_materializer` e confirma a linhagem do schema. `apply` exige
o sinal explícito `CRM_PRODUCTION_CUSTODY_CONFIRM=CRM_PRODUCTION_CUSTODY_APPLY`,
grava primeiro um checkpoint externo e então chama o writer transacional
idempotente. O writer revalida destino, principal, migration, locks e revisão;
uma falha faz rollback da transação.

Os arquivos de lote, checkpoint e recibo devem ficar fora do checkout. O
executor se recusa a ler ou escrever dentro do repositório e cria os recibos
com modo restrito, sem UUIDs de linhas, PII ou valores de segredo.

## Comandos

Planejamento, sem banco:

```powershell
npm run crm:production:custody -- `
  --mode plan --target production --unit novo-hamburgo `
  --batch-file C:\CodexRuntime\custody\atendimento-batch.json
```

Preflight somente leitura:

```powershell
$env:DATABASE_URL = '<URL PostgreSQL TLS do principal dedicado>'
npm run crm:production:custody -- --mode preflight --target production
```

Aplicação opt-in, dentro da janela de manutenção:

```powershell
$env:DATABASE_URL = '<URL PostgreSQL TLS do principal dedicado>'
$env:CRM_PRODUCTION_CUSTODY_CONFIRM = 'CRM_PRODUCTION_CUSTODY_APPLY'
npm run crm:production:custody -- `
  --mode apply --target production --unit novo-hamburgo `
  --batch-file C:\CodexRuntime\custody\atendimento-batch.json `
  --checkpoint-file C:\CodexRuntime\custody\checkpoint.json `
  --receipt-file C:\CodexRuntime\custody\receipt.json
```

O `DATABASE_URL` nunca deve ser colocado na linha de comando, em arquivo do
repositório ou em log. O candidato de produção, as chaves Identity, o gateway,
rotas e o publisher continuam sendo operações separadas: este executor não
faz deploy, não aplica migration, não cria rota e não aposenta o publisher
legado.

## Gates que permanecem obrigatórios

- lote UUID-only confirmado pelo owner e digestado;
- migration `20260910_atendimento_crm_core_identity_materialization_v1`
  ativa e schema compatível no banco de origem;
- principal mínimo provisionado fora do Git;
- backfill por domínio, publisher único, Identity, gateway, Pages e rollback
  comprovados por recibos externos independentes;
- três recibos finais (backfill, publisher único e aposentadoria) validados
  contra o mesmo candidato antes de qualquer troca de tráfego.

Sem um lote revisado admissível, o executor falha fechado. Registros sem
vínculo comprovado permanecem na fila externa de reconciliação e não podem ser
incluídos por aproximação de nome, telefone ou e-mail.
