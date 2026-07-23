# Núcleo operacional Financeiro

## Propriedade e fronteira

`finance/` é o único dono de schema D1, regras de lançamento, razão, importação,
auditoria e conciliação. O gateway apenas monta `/finance/*` e fornece a sessão
CRM já autenticada. `crm/console` transmite intenções tipadas para a API: não
calcula saldo, não equilibra partidas e não decide acesso.

Cada leitura e mutação exige um `scopeId` concedido em `finance_access_grants`.
Os escopos de unidade são independentes; o escopo pessoal existe no schema,
permanece `active=0` e não recebe concessões. Não há escopo que misture dados
pessoais com unidades empresariais.

## Modelo persistido

- `finance_accounts` representa caixa, banco, cartão e compensação. Cartão é
  conta de razão de passivo; as demais começam como ativo.
- Categorias têm pai no mesmo escopo e uma conta de razão de receita ou despesa.
  Favorecidos, tags e centros de custo também pertencem a um único escopo.
- `finance_movements` guarda o documento operacional com valor inteiro em minor
  units, moeda original ISO-4217, moeda-base, valor-base e taxa em ppm. A taxa
  nunca usa ponto flutuante.
- `finance_movement_splits` divide receita/despesa entre categorias e centros de
  custo. A soma dos splits original e base precisa ser exatamente o documento.
- `finance_installments` guarda vencimento, valor e baixa de cada parcela. Uma
  parcela só pode ser baixada em lançamento confirmado ou conciliado.
- `finance_journal_entries` e `finance_journal_lines` são o ledger operacional
  oculto. O serviço cria somente linhas balanceadas: receita (débito financeiro,
  crédito receita), despesa (débito despesa, crédito financeiro) e transferência
  (débito destino, crédito origem).
- Estorno gera `finance_reversal_entries` e linhas opostas; não altera nem apaga
  o lançamento original. Revisões, estornos e auditoria são append-only.
- Anexos são apenas metadados e chave de objeto privado nesta fase.

## Estados e correções

O estado de razão permanece `draft`/`posted`; a UI usa
`pending`/`confirmed`/`reconciled`/`cancelled`. Criar pendente não gera razão;
confirmar cria a partida. Conciliar não muda o valor. Cancelar lançamento já
postado só é possível pelo endpoint de estorno e produz linhas inversas. O
único `PUT` permitido é `/movements/:id` para um rascunho `draft`/`pending`.
Ele exige `expectedRevision`, substitui documento, splits, parcelas e tags na
mesma operação D1, e grava uma solicitação de revisão e evento append-only.
Uma versão desatualizada retorna conflito; lançamentos submetidos não têm
`PUT`, `PATCH` ou `DELETE`.

## Rotas atuais

- Leitura paginada: `/accounts`, `/categories`, `/payees`, `/tags`,
  `/cost-centers`, `/movements`, `/movements/:id`, `/overview`, `/audit` e
  `/attachments`.
- Criação: `/accounts`, `/categories`, `/payees`, `/tags`, `/cost-centers`,
  `/movements`, `/attachments`.
- Revisão controlada: `PUT /movements/:id` somente para rascunhos pendentes.
- Transições auditadas: `/movements/:id/confirm`, `/reconcile`, `/reverse` e
  `/installments/:id/pay`.
- Importação preserva o pipeline de staging: `/imports`, `/:id`, `/:id/preview`
  e `/:id/commit`.

Mutações exigem `Idempotency-Key`. A chave é ligada a ator, rota, escopo e hash
do payload; repetição idêntica devolve a resposta original e reutilização em
outro escopo ou com payload diferente retorna conflito. O Worker agrupa escrita
do documento, splits, razão, revisão, auditoria e chave de idempotência em uma
única `D1.batch`.

## Migrations aditivas

`0001` é a fundação original. `0002` adiciona estado operacional, moeda-base,
splits, revisões e estornos. `0003` adiciona guards D1 para impedir referências
entre escopos e torna revisões/estornos imutáveis. `0004`–`0007` acrescentam
staging de importação, adaptadores e guards do ledger. `0008` limita a revisão
atômica ao rascunho pendente e registra a versão esperada no banco. Nenhuma
migration anterior é reescrita para ativar esta evolução.

## Limites deliberados desta fase

Não há conector bancário, upload de conteúdo de anexo, câmbio automático,
reconciliação automática, deleção física, alteração de lançamento submetido ou
visão consolidada. A consolidação futura deve consultar somente escopos de
unidade explicitamente autorizados.
