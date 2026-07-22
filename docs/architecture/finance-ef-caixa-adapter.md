# Adaptador Caixa EF (`ef-caixa/v1`)

## Decisão e fronteira

`integration/ef` continua sendo o único responsável por navegar no Espaço Facial, coletar a interface e gravar os artefatos locais. Ele não recebe credenciais do Financeiro, não acessa D1 e não cria lançamentos. Ao final do modo manual `EF_MODE=caixa`, o coletor grava, junto ao XLSX, `caixa_finance_delivery_YYYYMMDD_a_YYYYMMDD.json` no diretório privado da unidade.

O Financeiro aceita o envelope somente via `POST /finance/imports?scopeId=...`, transforma-o em CSV canônico interno e percorre exatamente a mesma análise, staging, fingerprints, decisões, commit idempotente, partidas dobradas e estorno compensatório usados por CSV genérico e MoneyWiz. O CRM apenas seleciona o JSON, escolhe o escopo já concedido e conduz a revisão.

Não existe sincronização agendada ou chamada do coletor para o Financeiro nesta fase.

## Evidência da origem atual

O coletor real está em `integration/ef/espacofacial/cash.py` e `integration/ef/run_scraper.py`. O arquivo produzido por `EF_MODE=caixa` tem estas granularidades:

| Artefato/aba | Granularidade | Uso no Financeiro |
| --- | --- | --- |
| `Cliente` | linha por venda/pagamento, expandida quando a origem mostra meios mistos | única fonte importável nesta fase |
| `Cancelado` | subconjunto de `Cliente` cujo status contém cancelamento | evidência e revisão; nunca receita automática |
| `Forma Pagamento` | total diário por forma de pagamento | conferência humana, não lançamento individual |
| `Total` | soma do período por método | conferência humana, não lançamento individual |

Campos efetivamente disponíveis na linha detalhada: `Data`, `Horário`, `Cliente`, `Status`, `Valor`, `Crédito Cliente`, `Valor Pago`, `Parcelas`, `Pagamento` e, durante a extração, `Pagamento Raw`. A unidade vem de `EF_UNIT_NAME` e o período é o intervalo aplicado no Caixa. A origem não disponibiliza, de forma confiável, identificador nativo de venda, conta bancária de liquidação, taxa de adquirência, data de repasse, vínculo inequívoco de estorno ou cronograma de recebimento das parcelas.

Consequentemente, o coletor gera `externalId` determinístico quando a origem não traz ID nativo, mas ele não substitui um identificador oficial de venda. Repetições indistinguíveis permanecem revisáveis, e o Financeiro também mantém fingerprint de linha e lote.

## Contrato de entrega

O schema versionado é [finance-caixa.v1.json](../../integration/ef/contracts/finance-caixa.v1.json). O envelope exige:

- `contractVersion: "ef-caixa/v1"`;
- `source.executionId`, e opcionalmente `artifactId`/`artifactSha256`;
- `unit.slug` e `period.from`/`period.to` em ISO;
- `records` com data, valor pago em minor units, forma de pagamento, status e moeda.

O produtor Python usa `Decimal`, portanto a entrega não usa valores de ponto flutuante. A unidade é comparada no servidor com `finance_scopes.unit_slug`: Novo Hamburgo só entra em `novo-hamburgo`; BarraShoppingSul só entra em `barra-shopping-sul`; o contexto pessoal é recusado.

## Regras de normalização e revisão

- `Valor Pago` é o valor de receita candidata; `Valor` e `Crédito Cliente` ficam preservados na observação de origem.
- `Pagamento`/`Pagamento Raw` viram categoria proposta e tags de evidência; não escolhem uma conta Financeira automaticamente.
- `Parcelas` descreve a venda/cartão na origem. Sem cronograma de liquidação, não são parcelas Financeiro inventadas; ficam auditáveis na observação.
- Taxas, cancelamentos, estornos e referências de estorno recebem `review:*`, não podem ser marcados para importação como receita e exigem correção/estorno documentado no Financeiro.
- O resumo por forma de pagamento não é somado ao detalhado, evitando dupla contagem.
- Quando o coletor só encontra o resumo por pagamento e não há linhas detalhadas, ele preserva o XLSX e não emite entrega Financeiro; um agregado não tem rastreabilidade suficiente para virar lançamento.
- A fonte, o JSON original, identidade de origem, arquivo XLSX referenciado, mapeamento, resultado e decisões permanecem no lote/auditoria.

## Ativação

Uso apenas manual e controlado em períodos já conferidos. Antes de qualquer agenda automática, validar vários períodos das duas unidades contra o resumo diário, confirmar o tratamento operacional de taxas/estornos e aprovar o mapeamento de contas de liquidação.
