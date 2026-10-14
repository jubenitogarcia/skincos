# SKINCOS

Plataforma interna para automações e operações da clínica.

## Arquitetura atual

- `api/` é o único gateway de `api.skincos.com.br`.
- `finance/`, `inventory/`, `workforce/`, `messaging/`, `ads/`,
  `social/` e `integration/` mantêm seus próprios domínios.
- A fonte e os publicadores do Website, incluindo Booking, pertencem exclusivamente a
  [`jubenitogarcia/website`](https://github.com/jubenitogarcia/website). Este
  repositório mantém contratos e consumidores de APIs públicas, como
  `/api/booking/*`; esse registro de ownership não declara migração de runtime
  Cloudflare ou de dados.
- O CRM não está neste repositório. O projeto canônico é
  [`jubenitogarcia/crm`](https://github.com/jubenitogarcia/crm), localizado em
  `C:\\CodexShared\\Projetos\\crm`, com console, Core API, Worker/Pages, D1 e
  rollback próprios.
- O gateway encaminha somente `/crm/*` ao serviço independente, depois de
  verificar identidade e recibo assinado. Não existe fallback para código
  local.
- `integration/atendimento/commercial-catalog/` fornece o contrato de leitura
  `crm-commercial-catalog/v1` para automações; ele não é uma implementação de
  CRM e não possui rotas de escrita.

## Desenvolvimento e validação

O código é compartilhado pelo GitHub; cada computador mantém dependências e
estado privados. Consulte [ambientes locais Mac/Windows](docs/shared-local-environments.md)
para comparar refs, trabalhar em branches e configurar diretórios locais.

```text
npm run architecture:validate
npm run module-catalog:validate
npm run domain-boundaries:validate
npm run api:test
```

Cada domínio deste monorepo possui seu próprio `README` e scripts. Para trabalhar
no Website/Booking ou no CRM, abra o respectivo repositório independente.

## Operação e segurança

Produção usa artefatos imutáveis, contratos allowlisted e rollback do mesmo
publisher. Secrets, dados de cliente, cookies e estado de runtime ficam fora
do Git. GitHub Actions é opcional; os checks também podem ser executados pelo
Codex/WSL.

Consulte [`docs/service-catalog.md`](docs/service-catalog.md),
[`docs/ownership-model.md`](docs/ownership-model.md) e
[`docs/architecture/target-domain-map.md`](docs/architecture/target-domain-map.md)
para o mapa de responsabilidades.
