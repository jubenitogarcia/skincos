# ADR: identidade canônica da equipe por workforce_employee_id

- Status: proposta para validação em staging
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

As mudanças de schema são aditivas. O inventário multi-fonte é somente leitura,
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
7. Desativação mantém agenda, ponto, auditoria e histórico; bloqueia novos
   acessos/alocações conforme o estado governado.

## Fluxo de dados

    CRM account/onboarding ──explicit workforce_employee_id──> Workforce employee
             │                                                        │
             ├── explicit source link ──> Escala professional          ├── Ponto employee/events
             └── explicit source link ──> Atendimento professional      └── units/hierarchy/audit

    read-only snapshots -> sanitized inventory -> human review
                              -> dry-run links -> staging flag -> controlled rollout

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
manter a flag desligada fora do ambiente autorizado. O rollback desliga a flag e
restaura apenas vínculos novos identificados pelo fingerprint, sem apagar agenda,
ponto, nomes históricos ou auditoria. Falha de backup, conflito, divergência de
unidade ou revisão incompleta interrompe a operação.

## Consequências

O modelo exige inventário completo e revisão humana para dados antigos ou
ambíguos, mas impede a corrupção silenciosa de identidades. O Ponto já consome
o ID canônico do Workforce; a superfície de gestão central ainda precisa expor
essa presença na UI antes do rollout em staging.
