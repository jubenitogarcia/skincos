# ADR: identidade canônica da equipe por workforce_employee_id

- Status: aprovada para rollout controlado após validação em staging
- Escopo: CRM, onboarding/convites, Escala, Atendimento e Ponto
- Flag de rollout: UNIFIED_TEAM_ENABLED

## Contexto

Usuários e Equipe precisam compartilhar um cadastro operacional sem criar uma
segunda identidade para agenda, atendimento ou ponto. Nomes, e-mails e telefones
podem ser alterados, repetidos ou estar incompletos; portanto não são chaves de
vínculo. Registros históricos da Escala também precisam continuar legíveis.

## Decisão

workforce_employee_id é a identidade operacional canônica. Cada sistema mantém
seus próprios IDs e registra um vínculo explícito, auditável e reversível para
essa identidade. A conta CRM, o onboarding/convite e os profissionais da Escala,
Atendimento e Ponto não são unidos por semelhança textual.

As mudanças de schema são aditivas. A relação entre a conta CRM e o funcionário
é registrada em `crm_employee_account_links`, com `onboarding_id`,
`workforce_employee_id` e `crm_username` únicos; ela nasce no mesmo lote que o
registro do convite e nunca é inferida por nome, telefone ou e-mail. Contas
históricas sem essa linha permanecem pendentes para revisão. O inventário
multi-fonte é somente leitura,
gera fingerprint e expõe apenas subjects pseudonimizados. Duplicidades,
órfãos, divergências de unidade, registros sem ID e snapshots ausentes ficam em
pendência/conflito; nenhum deles gera vínculo confirmado automaticamente.

## Invariantes

1. Um funcionário ativo tem um workforce_employee_id estável.
2. Um ID de origem não pode apontar para dois funcionários.
3. Um funcionário não recebe dois vínculos confirmados no mesmo sistema.
4. Unidade e hierarquia são verificadas no servidor e sempre em fail-closed.
5. Nomes históricos da Escala são preservados em escrita dupla.
6. Convites são idempotentes, revogáveis e não carregam senha de equipe.
7. Uma conta CRM operacional só é considerada vinculada quando existe uma linha
   `CONFIRMED` em `crm_employee_account_links`.
8. Conta histórica sem vínculo confirmado só pode ser proposta por `crm_username`
   exato e exige revisão humana auditada; nome, e-mail e telefone não resolvem
   identidade.
9. Desativação mantém agenda, ponto, auditoria e histórico; bloqueia novos
   acessos/alocações conforme o estado governado.

## Fluxo de dados

    CRM account ──crm_employee_account_links──> onboarding ──explicit workforce_employee_id──> Workforce employee
             │                                                        │
             ├── explicit source link ──> Escala professional          ├── Ponto employee/events
             └── explicit source link ──> Atendimento professional      └── units/hierarchy/audit

    read-only snapshots -> sanitized inventory -> human review
                             -> dry-run links -> staging flag -> controlled rollout

## Gate de rollout controlado

A flag continua desligada por padrão. A ativação em produção só é elegível
quando o release exato tiver evidência de staging, migrations e dependências
prontas, smoke autenticado de configuração/listagem e rollback identificado.
Além disso, o workflow exige simultaneamente:

1. `production_unified_team_authorized=true` no dispatch do release; e
2. `ENABLE_UNIFIED_TEAM_PRODUCTION=true` no ambiente `production`.

O segundo item é uma autorização temporária do pipeline, não substitui a flag
de runtime e deve voltar a `false` depois da promoção. O runtime permanece
`UNIFIED_TEAM_ENABLED=true` somente no release de produção explicitamente
promovido; o rollback desliga essa flag através do fluxo governado.

## Contrato do inventário

O arquivo privado de entrada possui um objeto sources com as listas
crmAccounts, crmOnboarding, workforceEmployees, escalaProfessionals,
atendimentoProfessionals e pontoEmployees. Cada registro deve informar status,
ID de origem, workforceEmployeeId quando não for a fonte Workforce e units.

O comando inventory/scripts/unifiedTeamInventoryReport.mjs aceita
--input <arquivo.json> e imprime um relatório read-only com fingerprint,
cobertura, contagens, ready, pending, conflicts e ignored. O relatório não
retorna nomes, e-mails, telefones, IDs brutos ou conteúdo operacional privado.

## Rollback e operação

Antes de qualquer apply, manter backup verificável, registrar o fingerprint e
manter a flag desligada fora do ambiente autorizado. Em produção, o ambiente
autorizado é criado apenas pelo gate de rollout controlado acima. O rollback desliga a flag e
restaura apenas vínculos novos identificados pelo fingerprint, sem apagar agenda,
ponto, nomes históricos ou auditoria. Falha de backup, conflito, divergência de
unidade ou revisão incompleta interrompe a operação.

## Consequências

O modelo exige inventário completo e revisão humana para dados antigos ou
ambíguos, mas impede a corrupção silenciosa de identidades. O Ponto já consome
o ID canônico do Workforce; a superfície de gestão central ainda precisa expor
essa presença na UI antes do rollout em staging.
