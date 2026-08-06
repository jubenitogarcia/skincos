# Clientes — Data Analytics operacional

Status: implementado em `main` como tranche local/staging. A migration é aditiva e não habilita escrita comercial nem envio de mensagens.

## Contrato e escopo

O módulo expõe somente agregados sem PII:

* `GET /commercial/analytics/quality` — findings/eventos em série temporal, backlog, aging, tempos de reconhecimento/início/resolução, reopen rate, SLA, cobertura e freshness;
* `GET /commercial/analytics/funnel` — funil elegível → selecionado → ação → contato → entrega → resposta → agendamento → comparecimento → compra → retorno;
* `GET /commercial/analytics/experiments` e `GET /commercial/analytics/experiments/:id/results` — coortes persistidas, lift e receita incremental;
* `GET /commercial/analytics/segments` — definições, versões, snapshots, distribuição e drift.

Gestores com unidades declaradas recebem apenas agregados dessas unidades. A API rejeita uma unidade fora do escopo e nunca transforma ausência de permissão em contagem global. Administradores globais podem consultar o agregado global autorizado.

## Qualidade e freshness

O ledger existente `commercial_data_quality_finding_events` é a fonte temporal. Cada refresh materializa, de forma idempotente, um snapshot diário agregado em `commercial_data_quality_metric_snapshots`. O snapshot contém apenas contagens, idades, flags e timestamps de última execução válida; nenhum nome, telefone, e-mail, ID de cliente ou evidência bruta é aceito.

Métricas e denominadores:

| Métrica | Definição |
| --- | --- |
| backlog aging | horas desde `first_detected_at` para findings com contagem positiva |
| tempo até reconhecimento | média entre detecção/reabertura e primeiro status reconhecido |
| tempo até início | média entre detecção/reabertura e `in_progress` |
| tempo até resolução | média entre detecção/reabertura e resolução/clear |
| reopen rate | eventos `reopened` / eventos `detected` + `reopened` |
| cobertura de responsável | findings com responsável / findings conhecidos; em unidade, ações com responsável / ações |
| SLA vencido | findings/ações ativos com `sla_due_at` anterior ao instante da leitura |
| cobertura de identidade | identidades com pelo menos duas fontes / identidades visíveis no escopo |
| classificação de vendas | itens `mapping_status = mapped` / itens de venda |
| cobertura de consentimento | identidades com permissão WhatsApp concedida / identidades visíveis, somente quando a tabela pode ser lida |
| telefone correlacionado | identidades com registro app correlacionado / identidades visíveis; é um proxy de cobertura, não uma revelação de telefone |

O alerta preventivo ocorre antes de 24 horas sem uma leitura válida. Acima de 48 horas `source.local_mirror_stale` é finding alto e é reaberto automaticamente quando a próxima observação volta a ser stale. O finding só é resolvido por uma observação atual saudável; snapshots antigos não fecham a fila.

## Funil e attribution windows

A versão inicial `v1` congela resposta em 7 dias, agendamento em 14, comparecimento em 60, venda em 60 e retorno subsequente em 180. A âncora é o primeiro contato/ação da coorte. A API distingue:

* observada — evento ocorrido no período, sem inferir causalidade;
* atribuída — evento dentro da janela versionada da âncora;
* incremental — evento atribuído de um membro treatment acima do contrafactual do holdout.

Eventos posteriores à janela não são atribuídos indefinidamente. As dimensões aceitas são unidade, campanha, segmento, responsável, canal, oferta, período e versão da política. O fuso do banco é usado para o bucket; filtros de período são datas ISO explícitas.

## Experimentos

`commercial_analytics_experiments` e `commercial_analytics_assignments` congelam política, janela, período, unidade, segmento, seed e critérios. A variante é derivada por SHA-256 de `experiment + seed + identity`, persistida uma única vez e protegida por lock transacional. A coorte de controle fica bloqueada durante o período; tentativa de `action_created`, `contacted` ou `delivered` em controle é rejeitada como `EXPERIMENT_CONTROL_CROSSOVER`.

Resultados calculam conversões, taxa, receita, lift, receita incremental e intervalo normal aproximado de 95%. Com menos de 30 observações em qualquer braço, `INSUFFICIENT_SAMPLE` é retornado e o intervalo não é tratado como decisão.

## Segmentos explicáveis

Uma versão contém critérios, thresholds, percentis, vigência, autor, população e distribuição. O avaliador atual permite somente critérios explícitos (`minSources`, `requireAttendance`, `requireSale`); chaves que indiquem score, modelo, embedding, ML ou predição são recusadas. Membership e drift são snapshots append-only. Nenhum ranking opaco ou machine learning é introduzido nesta tranche.

## Migration, validação e rollback

Execute somente no espelho local ou em staging isolado, com `DATABASE_URL` privado e destino explícito:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\invoke-skincos-wsl.ps1 `
  -ProjectRoot (Get-Location).Path -WorkingDirectory crm/api `
  -NpmScript migrate-commercial-analytics -- --apply
```

O runner exige relações prévias, destino estrito local/staging, lock advisory e timeout. A role de runtime recebe `SELECT` e `INSERT` apenas nas tabelas analíticas; não recebe `UPDATE`, `DELETE` ou `TRUNCATE`. Triggers impedem mutações posteriores nos ledgers.

Rollback é não destrutivo: marca a migration como revertida e conserva evidência para investigação. Reaplicação é segura e idempotente. Antes de qualquer refresh, a fila de qualidade usa lock advisory e snapshot `repeatable read`; um refresh concorrente lê depois do commit anterior.

Validação mínima antes de promover:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\invoke-skincos-wsl.ps1 `
  -ProjectRoot (Get-Location).Path -WorkingDirectory crm/api -NpmScript test
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\invoke-skincos-wsl.ps1 `
  -ProjectRoot (Get-Location).Path -WorkingDirectory crm/console -NpmScript typecheck
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\invoke-skincos-wsl.ps1 `
  -ProjectRoot (Get-Location).Path -WorkingDirectory crm/console -NpmScript test
```

O smoke deve usar identidades sintéticas, uma unidade explicitamente autorizada, filtros na URL e o mesmo SHA validado. Não abrir escrita comercial, não registrar consentimento, não registrar contato e não enviar mensagens nesta tranche.
