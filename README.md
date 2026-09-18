# SKINCOS

Plataforma interna para automações e operações da clínica.

## Arquitetura atual

- `api/` é o único gateway de `api.skincos.com.br`.
- `finance/`, `inventory/`, `workforce/`, `messaging/`, `booking/`, `website/`,
  `ads/`, `social/` e `integration/` mantêm seus próprios domínios.
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

```text
npm run architecture:validate
npm run module-catalog:validate
npm run domain-boundaries:validate
npm run api:test
npm run quality:website
```

Cada domínio possui seu próprio `README` e scripts. Para trabalhar no CRM,
abra o projeto independente em `C:\\CodexShared\\Projetos\\crm`.

## Operação e segurança

Produção usa artefatos imutáveis, contratos allowlisted e rollback do mesmo
publisher. Secrets, dados de cliente, cookies e estado de runtime ficam fora
do Git. GitHub Actions é opcional; os checks também podem ser executados pelo
Codex/WSL.

Consulte [`docs/service-catalog.md`](docs/service-catalog.md),
[`docs/ownership-model.md`](docs/ownership-model.md) e
[`docs/architecture/target-domain-map.md`](docs/architecture/target-domain-map.md)
para o mapa de responsabilidades.
