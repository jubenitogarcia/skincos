# Content Studio n8n v2 — plano executável

## Objetivo

Receber `production_request` do organizador e devolver somente `content_package` validado. O sistema não agenda, publica nem ativa anúncios.

## Milestones e gates

1. **Baseline e auditoria** — preservar o builder legado, gerar baseline sanitizado, auditar grafo, Code nodes, hardcodes e binários. Gate: auditoria local sem segredos e mapa de migração versionado.
2. **Contratos e identidade** — schemas fechados, hashes canônicos, estados, fixtures e migração de `campaign_brief`. Gate: exemplos válidos/ inválidos e validação local.
3. **Builders CCG** — gerar os 11 workflows por código, com triggers de subworkflow, IDs estáveis, dry-run e rota de erro. Gate: build determinístico e grafo importável.
4. **Factories e adapters** — grounding, estratégia, preprodução, assets, cenas, áudio, assembly, finalização e adapters neutros. Gate: nenhum provider pago em testes e contratos preservados.
5. **Ledger, renderer e QA** — repository em memória/SQLite, idempotência, orçamento, renderer determinístico e bloqueios factuais. Gate: blockers reais não podem virar `NEEDS_REVIEW` automaticamente.
6. **Validação e E2E** — lint, testes, schemas, grafo, snapshots e oito cenários dry-run. Gate: stop-and-fix; qualquer vermelho interrompe o avanço.
7. **Documentação e handoff** — runbook, import order, rollback e acceptance report. Gate: declarar separadamente o que foi validado localmente e o que depende da instância n8n.

## Comandos de validação

```bash
npm run workflow:campaign-creative:v2:build
npm run workflow:campaign-creative:v2:validate
npm run workflow:campaign-creative:v2:test
npm run workflow:campaign-creative:v2:dry-run
```

O equivalente neste host deve ser executado em WSL Ubuntu-24.04 com `npm` disponível. Nenhum comando de teste pode usar provider pago, credencial real ou workflow de produção.

## Regra de parada

Se um gate falhar, corrigir a causa e repetir o gate antes de prosseguir. Mudanças não relacionadas no worktree devem permanecer intactas.
