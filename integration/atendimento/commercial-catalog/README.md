# Atendimento commercial catalog

This is the read-only owner service for the versioned `crm-commercial-catalog/v1`
contract consumed by Orb automations. It is deliberately outside the CRM Core
repository and never imports the CRM console, CRM Core, cookies, Identity
sessions or another product's database.

The service reads only active, date-valid offers from the Atendimento-owned
`crm_atendimento` schema. It binds to loopback by default, requires a dedicated
bearer secret, exposes `/health` and `/readiness`, and has no write route. The
Meta Ads path is a temporary response-shape alias for the inactive workflow and
must be removed after that workflow is migrated to the generic path.

Install dependencies with `npm ci` in this directory. Run `npm test` before
installing the accompanying systemd unit. Production credentials are supplied
only by the private runtime environment; no secret, customer row or token is
stored in Git.

The current owner database is the local PostgreSQL instance, so its unit sets
`ATENDIMENTO_COMMERCIAL_CATALOG_DATABASE_SSL=disable`. Set that variable to
`require` (and provide a CA when required by the database) when the owner moves
the contract to a TLS-enabled database.
