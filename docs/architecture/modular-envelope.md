# Modular Envelope

Skincos is moving from top-level technical buckets to a domain-first envelope.

## Canonical module roots

- `website/`
- `api/`
- `ads/meta/`
- `messaging/channels/whatsapp/`
- `workforce/`, `inventory/`, `finance/`, `booking`, `service/` e `integration/`

O produto CRM não possui mais uma raiz neste repositório. Seu código, Worker,
Pages, D1 e ciclo de release vivem exclusivamente em
`https://github.com/jubenitogarcia/crm`.

Orb/n8n is an external product boundary maintained in
[the independent Orb repository](https://github.com/jubenitogarcia/orb); this
envelope keeps only its integration contracts and observability references.

## Transitional roots

- `backend/` remains active only for shared infrastructure and modules not yet
  redistributed by domain

## Cross-cutting roots

- `platform/`: shared reusable code and contracts
- `ops/`: repo-level orchestration and runtime guidance
- `archive/`: rollback-only or deprecated material

O root `package.json` deve agir como orquestrador e expor comandos por domínio,
sem codificar caminhos ou publishers do produto CRM externo.
