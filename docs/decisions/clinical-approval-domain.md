# ADR: domínio independente de aprovação clínica

**Status:** aceito para implementação local/staging; produção desabilitada
**Data:** 2026-08-06

## Decisão

Cadências clínicas vivem no bounded context `clinical_approval`, exposto pelo
contrato interno `/api/clinical`. O domínio não é uma extensão de permissão do
CRM comercial: ele possui papel `CLINICAL_APPROVER`, ciclo próprio
`draft → submitted → approved|rejected → expired|disabled`, revisões
otimistas e histórico append-only.

O gestor comercial pode criar e submeter rascunhos na unidade permitida. A
aprovação exige aprovador clínico independente, impede autoaprovação e grava
justificativa, evidência, vigência, expiração, autor, aprovador e versão. Uma
revisão relevante invalida a aprovação anterior e cria nova revisão.

## Guardrails

- o schema é `clinical_approval`; o runtime da aplicação não recebe DDL;
- `rule_revisions`, `rule_events` e `command_dedup` são imutáveis no PostgreSQL;
- chave de idempotência e lock por procedimento/unidade protegem concorrência;
- a trigger de legado rejeita qualquer tentativa de gravar `approved` em
  `crm_atendimento.commercial_procedure_cadences`;
- Clientes ignora aprovações legadas e só lê regras aprovadas, vigentes e
  prontas no novo domínio;
- nenhuma regra vira prescrição, recomendação automática, campanha ou envio;
- unidade declarada é obrigatória para atores com escopo restrito;
- health é público sem PII; readiness é interno, exige ator autenticado e retorna 503 sem banco/schema;
- o catálogo online mantém `CLINICAL_APPROVAL_ENABLED=false`.

## Rollback e promoção

O rollback é não destrutivo: marca `rolled_back_at` no registro da migration,
retém evidências e mantém a trigger fail-closed. A ativação autorizada deve
ocorrer somente após dry-run local, apply isolado em staging, testes de
imutabilidade/concorrência, provisionamento do papel clínico e revisão
independente. Sem esses gates a produção permanece somente leitura e sem
recomendação clínica.
