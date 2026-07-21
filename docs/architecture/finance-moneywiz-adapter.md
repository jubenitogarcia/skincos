# Adaptador CSV MoneyWiz

O adaptador `moneywiz` é uma origem de importação, não um domínio financeiro e não uma rota para o ledger. Ele converte apenas o CSV de transações/relatórios para o mesmo contrato de staging genérico (`finance_import_batches` e `finance_import_rows`). O commit, deduplicação, autorização, partidas dobradas, auditoria e estorno continuam exclusivamente no domínio `finance`.

## Formatos aceitos com segurança

Aceitamos CSV com cabeçalho, delimitador vírgula ou ponto e vírgula, UTF-8 ou Windows-1252, e datas `YYYY-MM-DD` ou `DD/MM/YYYY`. A exportação deve ter `Date`, `Description` e `Amount`, ou então `Credits` e `Debits`. Esse é o mínimo e a convenção de campos publicada pelo MoneyWiz. [Guia de CSV do MoneyWiz](https://help.wiz.money/en/articles/4440549-how-do-i-format-csv-file-before-importing)

Campos reconhecidos quando presentes: `Account`, `Category`, `Payee`, `Tags`, `Memo`, `Status`, `Currency`, `Transfers`, `Transaction ID`/`External ID` e `Check #`. Categoria como `Pai > Filho` é preservada em `categoryPath`; ela não cria categorias nem altera a hierarquia do SKINCOS durante o staging. O MoneyWiz também documenta que receitas e despesas têm categorias distintas e que transferências não devem receber categoria operacional. [Categorias](https://help.wiz.money/en/articles/4810637-how-to-manage-transaction-categories), [transferências](https://help.wiz.money/en/articles/4440628-how-to-create-transactions).

## Regras deliberadamente conservadoras

- `Transfers` somente cria candidato de transferência e coloca a linha em revisão. Nenhum lado é convertido automaticamente em receita ou despesa, nem ambos são lançados sem confirmação.
- `Status`, tags, notas, moeda original, categoria e identificador externo são preservados na normalização e na evidência do lote. Eles não contornam as regras de confirmação financeira.
- Linhas sem data, descrição ou valor válido ficam inválidas no staging. Valores negativos continuam a determinar a direção de receita/despesa somente quando a linha não é uma transferência em revisão.
- Exportações de relatório funcionam se expuserem as colunas acima; colunas agregadas, linhas de subtotal, PDF, QIF, OFX, QFX e MT940 não são suportados por este adaptador CSV nesta fase.

O suporte é baseado na documentação pública do MoneyWiz, que descreve exportação CSV de relatórios e transações e ressalva que o conteúdo do arquivo reflete filtros e linhas expandidas na origem. [Exportação de relatório](https://help.wiz.money/en/articles/4440644-how-to-export-a-report-to-pdf-or-csv)
