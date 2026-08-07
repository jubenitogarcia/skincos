# Target domain map

This file is the source of truth for the domain-first reorganization.  It is a
migration contract, not a compatibility layer: after its respective cutover,
the former source path and public route must be removed rather than aliased.

## Root ownership

| Root | Owns | Does not own |
| --- | --- | --- |
| `ads` | Meta Ads campaigns, reporting and delivery | generic social publishing |
| `api` | the only HTTP boundary at `api.skincos.com.br` | domain business rules or data ownership |
| `booking` | availability, request lifecycle and reservation contracts | Selenium/browser execution |
| `crm` | console shell, customers, leads and permissions | extracted product internals |
| `finance` | cash, billing and financial imports | browser collection mechanics |
| `identity` | users, sessions, invitations, roles and permissions | inventory implementation or inventory data ownership |
| `integration` | external connectors, browser sessions and technical jobs | business data ownership |
| `inventory` | supplies and stock | the gateway implementation |
| `messaging` | inbox and channel adapters | social publishing |
| `orb` | workflows, scheduling, retries and operator automation | public API ownership |
| `service` | clinical treatment delivery and follow-up | system services or infrastructure |
| `social` | editorial publishing and publishing integrations | inbox conversations |
| `website` | public web experience | direct programmatic APIs after cutover |
| `workforce` | staff schedule and timekeeping | patient appointment availability |
| `shared` | neutral contracts and SDKs | product-owned implementations |
| `platform` | Cloudflare governance, security and observability | product domain logic |
| `ops` | deploy, runtime units and infrastructure definitions | mutable runtime state |
| `scripts` | executable human/CI commands grouped by owner | product implementation code |
| `tools` | active manual utilities | historical patches or vendor archives |

## Connector data ownership

`integration/ef` contains only external-system mechanics.  Its outputs are
accepted by the semantic owner:

- patient availability and reservations: `booking`;
- cash and payments: `finance`;
- procedures: `service`;
- clients: `crm`.

## Public and internal boundaries

- All programmatic public routes use `https://api.skincos.com.br/<domain>`.
- Website and CRM keep their UI deployments, but no longer expose separate
  programmatic API surfaces after their cutovers.
- `api/internal/*` has two callers: a CRM-authenticated human action or a
  private service identity used by Workers, Orb and integration executors.
- The gateway owns transport, request validation, authorization, correlation
  and error envelopes.  A domain owns its data model, migrations and business
  invariants.

## Clinical approval boundary

Clinical cadence approval is an independent bounded context even while the
clinical service remains experimental. Its implementation is isolated under
`crm/api/server/clinical`, its additive schema is `clinical_approval`, and its
authenticated contract is `/api/clinical`. `GESTOR` may create and submit a
draft; only `CLINICAL_APPROVER` may approve or reject it, with unit scope,
optimistic revision and an append-only event ledger. The Clientes commercial
router can only maintain drafts and reads approved rows from this domain; it
cannot approve, prescribe, or send a message. The context is disabled for
online launch until the schema, role, independent reviewer and staging
evidence gates are all present.

## Migration rules

- `archive/` is not a final code location.  Proven obsolete material is
  deleted after validation; Git history and verified runtime backups preserve
  recovery evidence.
- Vendor names are permitted only inside the isolated engine/dependency
  boundary required to execute that vendor.  They are not public names,
  runtime roots, service names or user-facing documentation.
- A product may depend on another product only through a documented contract
  in `shared/`; direct source imports across product roots are forbidden.
