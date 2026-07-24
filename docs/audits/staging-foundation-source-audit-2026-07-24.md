# Auditoria de fontes da fundação de staging — 2026-07-24

## Baseline

- Base auditada: `origin/main` em `4f152750`.
- Nenhum recurso remoto, segredo, flag, grant, usuário ou dado foi alterado nesta auditoria.
- Este documento registra somente nomes lógicos e commits. IDs, URLs de Workers, versões de deploy, dumps e valores de segredo são deliberadamente excluídos.

## Implementações ainda fora da main

| Fonte local | Commit | Conteúdo aproveitável | Estado nesta integração |
| --- | --- | --- | --- |
| `codex/admin/staging-isolation` | `34d26afb` | Worker de controle, D1/KV/R2/Queue/DLQ por domínio, inventário e bootstrap PostgreSQL | Extrair somente contrato lógico, guardas e templates sem IDs; não fazer cherry-pick do commit. |
| `codex/admin/staging-domain-migration` | `e1ce8fdc` | journal de migração, scripts de reconciliação e rollback de sombra | Extrair em PR posterior apenas scripts parametrizados e migrations de journal; não importar dados nem nomes de recursos existentes. |
| `codex/admin/postgres-staging-hardening` | `953a95fc` | papéis PostgreSQL e validações de staging, junto com mudanças de runtime CRM | Extrair em PR posterior apenas SQL de roles e validação; manter o runtime CRM fora deste escopo. |
| `codex/admin/finance-independent-pattern-shell` | `865daad1` | Worker/Pages independentes do Financeiro e artefatos de frontend | Fora de escopo: contém runtime e frontend, além de `crm/console/dist-finance/` não rastreado e descartável. |

Os commits acima permanecem preservados como snapshots recuperáveis. Nenhum deles é considerado prova de que a infraestrutura exista ou esteja saudável remotamente.

## Estado que já está na main

- Há configurações e workflows de staging legados para CRM Pages, API/Inventory, Escala e Ponto.
- `docs/staging.md` ainda descreve a branch `staging` como linha de desenvolvimento. Isso diverge do modelo de promoção imutável e será corrigido no runbook de bootstrap, sem reativar deploys legados.
- Financeiro possui evidência de staging no gateway e Pages, mas não um Worker de fundação independente promovido por esta auditoria.

## Limites e ordem segura de integração

1. Manifesto lógico e guardas de segredo/identificador (esta PR).
2. Templates, bootstrap, teardown protegido e Worker de controle, todos com execução remota opt-in.
3. Roles PostgreSQL, journal e reconciliação parametrizada, sem corte de tráfego ou cópia de dados.

Cada etapa deve ser revisada e validada em CI antes da próxima. Provisionamento remoto só poderá acontecer em uma janela aprovada, com estado gerado fora do repositório e feature flags desligadas.
