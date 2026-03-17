# Plano De Controle Estratégico

Este documento transforma a auditoria estratégica em trabalho executável dentro do repositório. O objetivo é reduzir risco real, substituir gates decorativos por controles verificáveis e diminuir entropia operacional.

## Fase 0

1. Remover token sensível de query string no fluxo de booking.
   Critério de aceite: `/api/booking/status` aceita token apenas por header dedicado ou `Authorization`; URLs com `token=` são rejeitadas.
   Status: concluído.
2. Endurecer guardrails de bypass local.
   Critério de aceite: CI falha se `LOCAL_AUTH_BYPASS=true`, `VITE_LOCAL_AUTH_BYPASS=true` ou `VITE_NO_AUTH` estiverem hardcoded no frontend.
   Status: concluído para frontend; expansão para outros domínios continua nas fases seguintes.
3. Tornar qualidade do frontend uma obrigação, não uma sugestão.
   Critério de aceite: `frontend` executa teste unitário na CI e publica cobertura.
   Status: concluído.

## Fase 1

1. Expandir testes unitários/integration do `frontend` para `Escala`, auth helpers e clients críticos.
2. Remover `best-effort`, `--if-present` e thresholds simbólicos dos caminhos que sustentam produção.
3. Formalizar baseline de cobertura por superfície: `website`, `frontend`, `backend`.

## Fase 2

1. Simplificar workflows de deploy/reconcile Cloudflare por domínio.
2. Definir staging reproduzível com smoke real antes de promoção.
3. Centralizar catálogo de segredos e rotação auditável.

## Fase 3

1. Implantar observabilidade de aplicação com erro agregado, correlação e owner por alerta.
2. Criar service catalog por domínio com dependências, SLO e runbook.
3. Distribuir ownership do repositório e revisar `CODEOWNERS`.

## Entregas aplicadas nesta rodada

- Guardrail do booking por header dedicado e rejeição de `token` em query string.
- Teste unitário/coverage no `frontend` com Vitest.
- Coverage do Python movida de 5% global para baseline real em `backend/config`.
- Testes unitários adicionais para `backend/config/constants.py` e `backend/config/environment.py`.
- Policy check para `dangerouslySetInnerHTML` e `new Function`.
- `pre-commit`/`pre-push` com checks de TS/React, Website, CRM API e Python.
- Catálogo de serviços, modelo de ownership e documentação reforçada de staging/observabilidade.

## Fase 4

1. Limpar artefatos gerados versionados e isolar legado.
2. Reduzir shell wrappers opacos e padronizar comandos raiz por workspace.
3. Revisar exceções de segurança como `new Function` e usos de HTML injetado.
