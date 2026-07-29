# Acceptance test report — Content Studio n8n v2

Data inicial: 2026-07-23. Branch: `codex/admin/content-studio-v2`.

| Requisito | Comando | Resultado | Evidência |
|---|---|---|---|
| Builder legado preservado | `node scripts/build-campaign-creative-generator.js` | PASS | `baseline/campaign-creative-generator-legacy/` com manifest SHA-256 |
| Auditoria do baseline | `node scripts/audit-campaign-creative-generator.js` | PASS | `docs/generated-current-workflow-audit.json` |
| Schemas versionados | `node scripts/generate-content-studio-schemas.js` | PASS | 17 schemas em `content-studio-v2/schemas` |
| Build determinístico CCG | `node scripts/build-campaign-creative-generator-v2.js` | PASS | 11 JSONs em `generated-workflows/campaign-creative-generator-v2` |
| Grafo n8n | `node scripts/validate-campaign-creative-generator-v2.js` | PASS | IDs/conexões/triggers sem nodes de publicação |
| Sintaxe/lint | `npm run lint` | PASS | executado no WSL Ubuntu-24.04 |
| Contratos, hashes, migração, ledger | `npm test` | PASS | `Content Studio v2 tests: OK`; AJV 8.20.0 instalado no WSL |
| Dry-run ponta a ponta | `node scripts/dry-run-content-studio.js` | PASS | 8 casos; `paid_calls: 0` |
| Renderer | teste + `services/renderer` | PASS | still SVG determinístico; vídeo dry-run como fixture válido |
| Provider pago | suite dry-run | PASS | `HttpProvider` bloqueia dry-run; só mock foi usado |
| Migration SQL | inspeção estática | PASS local | `db/migrations/20260723_content_studio_v2.sql`; aplicação remota não realizada |
| Import n8n | import limpo + arquivo do anterior | PASS | workflow único `TxE9eMS1xfE6kq38`; versões anteriores arquivadas e recuperáveis |
| Smoke n8n | execução manual `342` | PASS | fixture fixa, `dry_run=true`, mock, custo zero, 591 ms, sem nós externos |
| Audit de produção | `npm audit --omit=dev --json` | PASS | `follow-redirects` atualizado para 1.16.0; zero vulnerabilidades |

## Cenários E2E

`fast-static`, `standard-video`, `premium-hybrid`, `price-conflict`, `claim-without-source`, `provider-fallback`, `cta-revision` e `resume` foram executados. Os três primeiros e os quatro cenários operacionais aprovados retornaram `READY_TO_PUBLISH`; conflito retornou `NEEDS_REVIEW`; claim sem evidência retornou `FAILED`. Nenhum caso contém publicação.

## Limitações explícitas

- O vídeo em dry-run é um fixture JSON determinístico; encoding audiovisual com FFmpeg depende do runtime aprovado e não é chamado dentro de Code nodes n8n.
- O contrato real dos workflows organizador/postagem não está versionado neste repositório; adapters neutros estão documentados em `docs/integration-contract.md`.
- O workflow permanece inativo; a execução `342` foi um smoke manual de fixture e não ativou, publicou, agendou ou chamou provedor externo.
