# Exportador de projeções opacas de Atendimento para CRM Core

Este adaptador prepara o primeiro lote de backfill para o CRM independente.
Ele lê exclusivamente `id` e `updated_at` de
`crm_atendimento.global_client_identities`, em uma transação PostgreSQL
`REPEATABLE READ READ ONLY`.

Antes de o lote sair do adaptador, cada UUID vira uma referência HMAC opaca:

- `source:` identifica a origem sem expor o UUID;
- `projection:` identifica a projeção CRM sem copiar o registro do cliente;
- `event:` torna o replay idempotente.

O lote não contém nomes, e-mails, telefones, contato, sessões, cookies,
credenciais, dados de venda ou qualquer outra coluna da origem. A chave HMAC
fica somente na custódia operacional privada; ela nunca é escrita neste
repositório, em logs ou em recibos Git.

## O que este adaptador ainda não faz

Ele não abre uma conexão por conta própria, não cria usuário PostgreSQL, não
aplica grant, não grava no CRM Core, não cria rota, e não faz deploy. Um runner
operacional futuro deve injetar um pool já autenticado com o principal dedicado
`crm_core_projection_exporter`, limitado a `CONNECT`, `USAGE` no schema
`crm_atendimento` e `SELECT (id, updated_at)` na tabela indicada.

O exportador falha fechado quando o principal, banco, transação somente-leitura,
contagem, formato de linha ou limite não correspondem ao contrato. A primeira
carga é propositalmente um snapshot completo e limitado; se o volume superar o
limite, ele não pagina nem cria um backfill parcial.

## Validação local

No ambiente Linux do projeto:

```text
node --test integration/atendimento/crm-core-projection-exporter/test/*.test.mjs
```

Essa validação usa apenas uma fonte sintética em memória. Ela não acessa banco,
Cloudflare, dados de clientes ou segredos.
