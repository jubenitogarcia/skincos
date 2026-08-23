# Auditoria do baseline atual

Fonte: `scripts/build-campaign-creative-generator.js`, export reconstruído localmente em `workflows/` e relatório histórico em `docs/campaign-creative-generator-report.md`.

## Evidências

| Item | Evidência | Risco |
|---|---|---|
| Entrada de produção | `build-campaign-creative-generator.js:37`, `manual()`; os cinco workflows legados incluem Manual Trigger | Não existe contrato de `production_request` como entrada principal |
| Configuração estática | `build-campaign-creative-generator.js:870-895` cria `campaign_name`, IDs de Drive, modo e limites no Set | IDs/campanha podem ser promovidos por engano |
| Limites | `build-campaign-creative-generator.js:443-470` usa `imageIndex < 8`, enquanto `max_source_files` não controla a busca `returnAll: true` | Configuração declarada não é autoridade operacional |
| Python/child process | `build-campaign-creative-generator.js:411-431` chama `child_process.execFileSync('python3', ...)` | Não é portável e prende produção ao ambiente local |
| Binário/base64 | `build-campaign-creative-generator.js:408`, `739-757` decodifica base64 e transporta binário entre nodes | Payload grande e maior risco de retenção de dados |
| Interpretação | `build-campaign-creative-generator.js:939-955` concentra campanha, visual, oferta e compliance em `Campaign Interpreter` | Ciência, comercial e direção de arte não são separáveis |
| Planner | `buildVariationPlanCode` monta `generation_prompt` final e jobs estáticos | Não há blueprint, cena, áudio ou clean plate explícitos |
| Revisão | O baseline histórico registra `reference_sheet`, mas o validator exige que revisão envie somente `current_asset` | Referências de campanha não são garantidas no request de revisão |
| QA | `finalizeQaCode` transforma qualquer `fail` em `failed`, mas `compliance=needs_review` não é bloqueante | A decisão factual não tem matriz de bloqueios |
| Idempotência/ledger | `buildLedgerCode` gera manifest, sem lookup por hash, dependências, custo ou invalidação | Reexecução pode gastar novamente |
| Convergência | O relatório usa `$input.all()` e nomes de contexto, sem collector explícito | Ramos podem produzir contagens incompletas |

## O que continua funcionando

- Builder determinístico de cinco exports legados.
- Download/extração e interpretação estruturada do fluxo anterior.
- Planejamento básico por formato/variação.
- Rota live de imagem e upload no Drive existem, mas ficam fora dos testes v2.

## O que muda no v2

- `production_request` substitui configuração de campanha embutida.
- Grounding, estratégia, preprodução, factories, assembly, finalização e QA têm contratos próprios.
- Providers têm adapters e mock; assets e jobs usam hashes e ledger.
- O pacote final é `content_package`; não existe node de postagem/agendamento.
