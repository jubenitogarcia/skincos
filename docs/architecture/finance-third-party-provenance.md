# Proveniência e licenças — Financeiro

Revisado em 2026-07-21.

| Material | Uso no Financeiro | Licença/atribuição | Decisão |
| --- | --- | --- | --- |
| Actual Budget / `actual-server` | Referência arquitetural seletiva documentada; nenhum arquivo, dependência, banco ou código executável foi importado. | O projeto é MIT, mas não há trecho copiado que exija aviso nesta branch. | Não é fonte de dados nem dependência. |
| Documentação pública MoneyWiz | Identificação de campos de CSV, citada em `finance-moneywiz-adapter.md`. | Documentação consultada, não código redistribuído. | Manter links de referência; não copiar textos extensos ou código. |
| Espaço Facial / `integration/ef` | Contrato e adaptador originais deste repositório para entrega controlada. | Código do próprio SKINCOS. | Continua isolado em `integration`; Finance apenas normaliza o contrato. |
| Miniflare, Vitest e dependências declaradas | Somente ferramentas/dependências já registradas pelos manifests do projeto. | Governadas pelos respectivos manifests e lockfiles. | Nenhum código de terceiros foi colado nos arquivos do domínio. |

Não foram identificados arquivos de licença incompatível ou blocos reaproveitados
sem proveniência. Uma revisão posterior deve atualizar este registro se houver
copiagem de código, SDK bancário ou parser de terceiros, incluindo o texto de
atribuição exigido no artefato distribuído.
