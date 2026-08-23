# Runbook operacional

1. Gere e valide os workflows com `npm run workflow:campaign-creative:v2:build` e `npm run workflow:campaign-creative:v2:validate`.
2. Execute `npm run workflow:campaign-creative:v2:dry-run`; confirme `paid_calls: 0`.
3. Para FAST/STANDARD/PREMIUM, envie `production_request` conforme o schema e altere apenas `production_tier`/`content_type`.
4. Retome uma produção pelo mesmo `production_id`; o ledger reutiliza jobs `DONE` com o mesmo `input_hash`.
5. CTA altera somente overlays/master; claim altera blueprint, cenas, áudio e timeline conforme o grafo de invalidação.
6. `NEEDS_REVIEW` requer revisão humana; `FAILED` com `blocking_issues` não deve ser promovido.
7. Consulte o ledger no adapter/repository do projeto de teste; não edite a base de produção diretamente.
8. Mantenha `dry_run=true`, `mock_provider=true` e `publish_requested=false` durante desenvolvimento.
