# Clientes Readonly boundary

This directory is the source boundary for the future `skincos-clientes-readonly`
product. It is not a deployed service, does not own a database, and does not
route production traffic.

`clientes-readonly/v1` accepts only a redacted, explicitly scoped actor and
projects only the five fields declared by the contract. The only future data
routes are `GET`/`HEAD /v1/clientes` and `GET`/`HEAD /v1/clientes/:clientId`.
Until both a dedicated read-model and authenticated actor adapter are supplied,
both routes return an unavailable error; they never fall back to the CRM runtime,
commercial flows, Harmonia, or Caixa.

Health remains PII-free. `GET /health` reports the unavailable dependency with
HTTP 200 so liveness is observable; `GET /readiness` returns HTTP 503 until
both required adapters are explicitly configured and the read-model is ready.

The next extraction milestone must provide a dedicated read-model owner,
authenticated actor adapter, staging proof, rollback, and its own deploy
surface before this boundary can become a repository or receive traffic.
