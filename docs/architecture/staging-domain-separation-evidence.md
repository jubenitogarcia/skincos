# Staging domain separation evidence

Recorded: 2026-07-23. Scope: isolated Cloudflare D1 staging targets only. No
production D1, Worker, route, secret, feature flag or customer-data export was
changed.

## Compatibility and rollback

The shared `skincos-db-staging` remains `read-primary` for the current
Identity, Inventory and Finance application paths. The isolated D1s are shadow
stores and their control Workers expose `/migration-status`; they are not bound
to the production gateway or to a customer route.

Before migration, SQL exports of the three target D1s were written to the
private operator runtime. Rollback is lossless: keep `module_enabled=false`,
leave the shared staging D1 primary, mark the latest shadow run as rolled back
with `SKINCOS_STAGING_ROLLBACK_ACK=1 node
platform/staging-foundation/scripts/rollback-staging-domain-shadow.mjs
<domain>`, and retain the isolated data/journals for audit. Restoring a target
is only necessary for an isolated-staging incident and uses the private export;
rollback never deletes migrated rows.

## Applied independent migration journals

| Domain | Target D1 | Journal | Applied files | Functional status |
| --- | --- | --- | ---: | --- |
| Identity | `skincos-identity-staging` | `identity_release_migrations` | 1 | `/migration-status` verified; 20 pseudonymous subjects |
| Inventory | `skincos-inventory-staging` | `inventory_release_migrations` | 16 | `/migration-status` verified; one synthetic category |
| Finance | `skincos-finance-staging` | `finance_release_migrations` | 12 | `/migration-status` verified; flag remains false |

Every applied migration file has a SHA-256 checksum in its domain journal.
Each target also has `domain_migration_runs` and
`domain_migration_objects`, which record source/target counts, safe checksums,
classification and action.

## Reconciliation result

| Domain | Copied or reconciled | Result | Sensitive rows retained in shared staging |
| --- | --- | --- | --- |
| Identity | 20 `crm_users` authorization shapes, pseudonymized and non-loginable | count 20/20; semantic checksum matched | Invites, reset tokens and preferences were not copied (all zero) |
| Inventory | five operational collections | all were zero/zero; a clearly labelled synthetic category validates the isolated schema | none present in the audited source collections |
| Finance | `finance_settings` (1) and `finance_scopes` (3) | counts and checksums matched; `module_enabled=false` | 15 movements, 6 import batches, 19 import rows and 43 audit events, plus dependent sensitive collections |

No passwords, sessions, usernames, email addresses, reset tokens, financial
descriptions, payees, imports or audit evidence were copied. There is no
production-data copy in this operation.

## Required audit before any production cutover

1. Approve and test a domain-specific sanitizer for retained financial and
   identity-sensitive records, including relation-preserving synthetic IDs.
2. Run a new source snapshot and reconcile deltas, rather than assuming this
   staging snapshot remains current.
3. Validate the real independent domain runtimes with authenticated sessions,
   permission matrices, failure fallback and rollback to the shared adapter.
4. Review migration journals, D1 backup restore evidence, checksums, logs and
   the explicit disabled feature flags. Only then consider a separate staging
   routing/cutover request; production requires its own audit and approval.
