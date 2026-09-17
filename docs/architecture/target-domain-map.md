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
| `crm` | `jubenitogarcia/crm` (Worker, Pages, D1 and release; external boundary) | qualquer implementação, datastore ou publisher dentro deste monorepo |
| `finance` | cash, billing and financial imports | browser collection mechanics |
| `identity` | users, sessions, invitations, roles and permissions | inventory implementation or inventory data ownership |
| `integration` | external connectors, browser sessions and technical jobs | business data ownership |
| `inventory` | supplies and stock | the gateway implementation |
| `messaging` | inbox and channel adapters | social publishing |
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
- clients: Atendimento's versioned read-only catalog; CRM consumes only the gateway contract.

## Public and internal boundaries

- All programmatic public routes use `https://api.skincos.com.br/<domain>`.
- Website and the independent CRM keep their own UI deployments. The monorepo
  exposes only the API gateway and never publishes a CRM UI or API runtime.
- `api/internal/*` has two callers: a CRM-authenticated human action or a
  private service identity used by Workers, the external automation contract
  and integration executors.
- The gateway owns transport, request validation, authorization, correlation
  and error envelopes.  A domain owns its data model, migrations and business
  invariants.

## Clinical approval boundary

Clinical cadence approval remains an experimental bounded context. Its owner
must provide a service under `service/` before an online route is enabled; no
Clinical approval remains a contract owned by its clinical domain; no
implementation is retained under a CRM tree in this repository.

## Migration rules

- `archive/` is not a final code location.  Proven obsolete material is
  deleted after validation; Git history and verified runtime backups preserve
  recovery evidence.
- Vendor names are permitted only inside the isolated engine/dependency
  boundary required to execute that vendor.  They are not public names,
  runtime roots, service names or user-facing documentation.
- A product may depend on another product only through a documented contract
  in `shared/`; direct source imports across product roots are forbidden.
