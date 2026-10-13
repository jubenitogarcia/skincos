# Catálogo de serviços

Este catálogo descreve os donos atuais. O monorepo não publica nem executa o
CRM: o único projeto CRM é `jubenitogarcia/crm`, em
`C:\CodexShared\Projetos\crm`.

## CRM independente

- Repositório: <https://github.com/jubenitogarcia/crm>
- Interfaces: `https://crm.skincos.com.br` e
  `https://api.skincos.com.br/crm/*`.
- Dados, Worker, Pages, D1, autenticação de aplicação e rollback pertencem ao
  repositório independente.
- O gateway `api/` apenas valida o envelope externo e encaminha `/crm/*`; não
  há cópia de código, banco, cookie ou segredo do CRM neste monorepo.

## Website independente

- Repositório exclusivo de fonte e publicação:
  <https://github.com/jubenitogarcia/website>.
- Este monorepo conserva contratos e consumidores de APIs públicas, incluindo
  booking e tracking, quando outros produtos dependem deles.
- O registro de ownership da fonte não afirma que o runtime ou as rotas
  Cloudflare já foram migrados.

## API e domínios

- `api/`: único limite HTTP de `api.skincos.com.br`; encaminha contratos para
  Financeiro, Inventário, Ponto e CRM independente.
- `finance/`: ledger, contas, obrigações, importações e auditoria financeira.
- `inventory/`: insumos, estoque e movimentos.
- `workforce/`: Escala e Ponto.
- `messaging/`: engine e adaptadores de WhatsApp.
- `booking/`: disponibilidade e reservas.
- `ads/`, `social/`: campanhas, relatórios e publicação editorial.
- `integration/atendimento/commercial-catalog/`: contrato somente-leitura
  `crm-commercial-catalog/v1` para automações; não é CRM e não grava dados.

## Validação local

Use os scripts raiz e os testes do dono correspondente. Os checks principais
são `npm run architecture:validate`, `npm run module-catalog:validate`,
`npm run domain-boundaries:validate` e `npm run api:test`. Cada repositório
independente mantém seu próprio build, testes e publicador.

## Operação

Secrets, dados de produção e estado de runtime ficam fora do Git. GitHub Actions
é apenas executor opcional; validações equivalentes podem ser executadas pelo
Codex/WSL.
