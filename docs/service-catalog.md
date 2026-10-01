# Catálogo de serviços

Este catálogo descreve os donos atuais. O monorepo não publica nem executa o
CRM: o único projeto CRM é `jubenitogarcia/crm`, em
`C:\\CodexShared\\Projetos\\crm`.

## CRM independente

- Repositório: <https://github.com/jubenitogarcia/crm>
- Interfaces: `https://crm.skincos.com.br` e
  `https://api.skincos.com.br/crm/*`.
- Dados, Worker, Pages, D1, autenticação de aplicação e rollback pertencem ao
  repositório independente.
- O gateway `api/` apenas valida o envelope externo e encaminha `/crm/*`; não
  há cópia de código, banco, cookie ou segredo do CRM neste monorepo.

## API e domínios

- `api/`: único limite HTTP de `api.skincos.com.br`; encaminha contratos para
  Financeiro, Inventário, Ponto e CRM independente.
- `finance/`: ledger, contas, obrigações, importações e auditoria financeira.
- `inventory/`: insumos, estoque e movimentos.
- `workforce/`: Escala e Ponto.
- `messaging/`: engine e adaptadores de WhatsApp.
- `booking/`: disponibilidade e reservas.
- `website/`: experiência pública e APIs do site.
- `ads/`, `social/`: campanhas, relatórios e publicação editorial.
- `integration/atendimento/commercial-catalog/`: contrato somente-leitura
  `crm-commercial-catalog/v1` para automações; não é CRM e não grava dados.

## Validação local

Use os scripts raiz e os testes do dono correspondente. Os checks principais
são `npm run architecture:validate`, `npm run module-catalog:validate`,
`npm run domain-boundaries:validate`, `npm run api:test` e os testes de cada
domínio. O repositório independente possui seu próprio `npm test`, build e
publisher.

## Operação

Secrets, dados de produção e estado de runtime ficam fora do Git. GitHub Actions
é apenas executor opcional; validações equivalentes podem ser executadas no
Codex/WSL.
