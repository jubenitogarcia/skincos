# Campaign Creative Generator - Relatorio de Implementacao

## Workflows criados no n8n

- `ccg-orchestrator-001` - `00 - Orquestrador - Campaign Creative Generator`
- `ccg-phase1-interpret-campaign` - `01 - Interpretar Campanha`
- `ccg-phase2-plan-variations` - `02 - Planejar Variacoes`
- `ccg-phase3-generate-asset` - `03 - Gerar 1 Peca`
- `ccg-phase4-qa-ledger` - `04 - QA, Export e Ledger`

Todos foram importados como inativos.

## Arquivos locais

- `workflows/campaign-creative-generator.package.json`
- `workflows/campaign-creative-generator.00-orquestrador.json`
- `workflows/campaign-creative-generator.01-interpretar-campanha.json`
- `workflows/campaign-creative-generator.02-planejar-variacoes.json`
- `workflows/campaign-creative-generator.03-gerar-1-peca.json`
- `workflows/campaign-creative-generator.04-qa-export-ledger.json`
- `scripts/build-campaign-creative-generator.js`
- `scripts/validate-campaign-creative-generator.js`

## Operacao

Gerar os JSONs novamente:

```bash
npm run workflow:campaign-creative:build
```

Validar estrutura e dry-run deterministico:

```bash
npm run workflow:campaign-creative:validate
```

Importar ou atualizar os workflows no n8n:

```bash
n8n import:workflow --input=workflows/campaign-creative-generator.package.json
```

## Entrada do orquestrador

Edite o node `Configuracao Inicial`:

```json
{
  "campaign_name": "Campanha Maio",
  "source_drive_folder_id": "google-drive-folder-id",
  "output_drive_folder_id": "google-drive-folder-id",
  "execution_mode": "dry_run",
  "requested_formats": "[\"feed_3x4\",\"stories_9x16\",\"square_1x1\",\"website_banner\",\"horizontal_ad\"]",
  "variation_mode": "auto_all",
  "max_variations_per_format": 6,
  "brand": "Espaco Facial",
  "compliance_note": "Avaliacao individual. Resultados variam."
}
```

## Comportamento implementado

- Fase 1 baixa materiais do Drive, grava copia temporaria em `/tmp/n8n-campaign-creative`, extrai texto de PDFs via Python (`pypdf`/`PyPDF2`) e envia imagens anexadas ao `Campaign Interpreter`.
- Fase 2 gera jobs por formato e variacao, sempre com 1 imagem final por job.
- Fase 3 em `dry_run` nao chama OpenAI nem Drive; em `live` chama `POST /v1/images/generations`, monta binario PNG e sobe no Drive.
- Fase 4 em `dry_run` marca `needs_review`; em `live` baixa a imagem gerada do Drive, executa QA multimodal e grava um manifest JSON no Drive.

## Validacao executada

```bash
npm run workflow:campaign-creative:validate
```

Resultado:

- Structural validation: OK
- Phase 2 deterministic variation plan: OK
- Phase 3 job normalization: OK
- Phase 3 OpenAI request mapping: OK
- Phase 3 dry-run asset: OK
- Phase 4 dry-run QA: OK
- Phase 4 manifest mapping: OK
- Dry-run deterministic validation: OK

## Rollback

Antes do primeiro import foi criado backup do banco local do n8n em:

```text
/Users/jubenitogarcia/.n8n/backups/database.before-campaign-creative-generator.20260528-171556.sqlite
```

## Otimizacao do workflow unificado em 2026-06-01

O workflow consolidado pelo usuario em `ccg-orchestrator-001` foi otimizado diretamente no n8n salvo:

- Nome salvo: `Campaign Creative Generator`
- Status apos otimizacao: inativo
- Snapshot antes da otimizacao: `workflows/campaign-creative-generator.unified.before-optimize.20260601.json`
- Snapshot otimizado importado: `workflows/campaign-creative-generator.unified.optimized.json`
- Snapshot atual exportado do n8n: `workflows/campaign-creative-generator.unified.current.json`
- Script reproduzivel: `scripts/optimize-campaign-creative-generator-unified.js`

Mudancas aplicadas:

- Restaurada `Configuracao Inicial` editavel com campos de campanha, Drive, modo, limites, formatos e modelo de imagem.
- Adicionado preflight em `Preparar Orquestracao` para bloquear execução com IDs de pasta ausentes ou placeholders.
- `Search Campaign Files` passou a usar limite configuravel (`max_source_files`) em vez de buscar tudo sem limite.
- `Prepare Campaign Inputs` passou a respeitar `max_image_references` e `max_pdf_chars`.
- `Build Variation Plan` agora evita variações sem insumo suficiente, limita `max_jobs_total`, nao cria variação de preço sem preço confirmado e preserva `image_model`.
- `Switch Modo Geracao` agora bloqueia jobs inválidos antes da chamada live de imagem.
- Corrigido `Upload Generated Asset` com `resource=file`, `operation=upload` e `inputDataFieldName=data`.
- `Configuracao Fase 1/2/3/4` ficou explicitamente como passthrough (`keepOnlySet=false`) para preservar o payload no workflow unificado.

Validacao executada:

```text
Unified current validation: OK
jobs 1 campanha_x__stories_9x16__hero__v1
```

## Unificacao dos Edit Fields em 2026-06-01

Foi aplicada a unificacao dos nodes `Edit Fields`/`Set` no workflow vivo `ccg-orchestrator-001`.

Arquivos:

- Rollback antes da mudanca: `workflows/campaign-creative-generator.unified.before-edit-fields-unification.20260601.json`
- Workflow importado: `workflows/campaign-creative-generator.unified.edit-fields-unified.json`
- Snapshot atual exportado: `workflows/campaign-creative-generator.unified.current.json`
- Script reproduzivel: `scripts/unify-campaign-creative-generator-edit-fields.js`

Mudancas aplicadas:

- Removidos `Configuracao Fase 1`, `Configuracao Fase 2`, `Configuracao Fase 3` e `Configuracao Fase 4`.
- Mantido apenas `Configuracao Inicial` como node editavel de variaveis.
- Refeito o roteamento direto:
  - `Preparar Orquestracao` -> `Search Campaign Files`
  - `Normalize Campaign Brief` -> `Normalizar Brief`
  - `Build Variation Plan` -> `Normalizar Job de Geracao`
  - `Live Asset Result` -> `Normalizar Resultado Gerado`
- `Prepare Campaign Inputs` e `Normalizar Job de Geracao` passaram a buscar configuracao em `Preparar Orquestracao` com fallback para `Configuracao Inicial`.

Validacao:

```text
editFields Configuracao Inicial
nodes 39 connections 32
hasFaseRefs false
```

## Limpeza e renomeacao de variaveis em 2026-06-01

Foi aplicada no workflow vivo `ccg-orchestrator-001` a limpeza das variaveis de configuracao.

Arquivos:

- Rollback antes da mudanca: `workflows/campaign-creative-generator.before-variable-cleanup.20260601.json`
- Workflow importado: `workflows/campaign-creative-generator.variable-cleanup.json`
- Snapshot atual exportado: `workflows/campaign-creative-generator.unified.current.json`
- Script reproduzivel: `scripts/cleanup-campaign-creative-generator-vars.js`

Variaveis removidas de todo o workflow:

- `execution_mode`
- `variation_mode`
- `image_model`
- `fallback_image_models`
- `brand`
- `compliance_note`

Variaveis renomeadas:

- `campaign_name` -> `campaign_folder`
- `source_drive_folder_id` -> `source_folder_id`
- `output_drive_folder_id` -> `output_folder_id`

Constantes atuais no node `Configuracao Inicial`:

```json
{
  "campaign_folder": "06",
  "source_folder_id": "16a48rrGRdxcF8NMH51Vf25PYVM4hFxHQ",
  "output_folder_id": "1uZvk2fEzrKiDT2LHvwCbJR-B4fKdhA_Y",
  "requested_formats": "[\"feed\",\"stories\",\"square\",\"website_banner\"]",
  "max_variations_per_format": 3,
  "max_jobs_total": 30,
  "max_source_files": 40,
  "max_image_references": 8,
  "max_pdf_chars": 12000
}
```

Validacao:

```text
removedHits none
prep 06 16a48rrGRdxcF8NMH51Vf25PYVM4hFxHQ 1uZvk2fEzrKiDT2LHvwCbJR-B4fKdhA_Y feed|stories|square|website_banner
jobs 12 feed:hero,feed:oferta_principal,feed:combo,stories:hero
norm ready gpt-image-2 1uZvk2fEzrKiDT2LHvwCbJR-B4fKdhA_Y
```
