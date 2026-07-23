# CRM extraction sequence

This sequence separates runtime availability before business domains. Each PR
is independently reviewable, reversible and must pass its stated staging gate
before the next one is opened. The gateway remains limited to transport,
identity, authorization, correlation and routing; it does not own domain rules,
worker loops, migrations or provider execution.

| Order | PR scope | Dependency | Gate before next PR | Rollback |
| --- | --- | --- | --- | --- |
| 1 | Continuous jobs and workers | None | `crm-jobs.service` health/readiness, CRM remains healthy when worker DB is unavailable, controlled recovery | Stop `crm-jobs`, restore prior immutable CRM release and restart only CRM |
| 2 | Harmonia HTTP/domain boundary | PR 1 staging evidence | Harmonia process health/readiness, API route contract, task queue recovery and gateway routing only | Route gateway back to prior Harmonia artifact; leave queue data compatible |
| 3 | WhatsApp and heavy integrations | PR 2 staging evidence | Provider outage leaves Harmonia/CRM available, idempotent delivery/retry evidence and no duplicate send | Disable provider flag, stop integration process and reconcile delivery IDs |
| 4 | Atendimento | PR 3 staging evidence | Independent process health/readiness, local mirror failure isolation and protected route smoke | Restore prior Atendimento artifact; keep additive schema and mirror checkpoint |
| 5 | Caixa | PR 4 staging evidence | Import worker/API isolation, dry-run/import idempotency and downstream dependency outage test | Disable import flag and restore prior artifact without mutating source receipts |
| 6 | Remaining domains | Prior relevant gate | One PR per domain: service contract, dependencies, health/readiness, rollback and chaos case | Domain-specific rollback recorded in its module catalog entry |

## Non-negotiable PR gate

Every extraction must include all of the following in the same PR:

1. an independently supervised process or Worker, with owner and immutable
   artifact identity;
2. `/health`, `/readiness`, dependency status and version without personal data
   or secrets;
3. explicit feature/activation flag defaulting to disabled where exposure is
   new;
4. an additive and separately executed migration when data changes;
5. a rollback command that affects only the extracted unit;
6. a test that makes one required dependency unavailable and proves unrelated
   CRM/gateway routes remain healthy;
7. staging evidence attached to the promotion record before the next PR.

Do not combine two rows in one PR. A failed or incomplete gate pauses the
sequence; it is not bypassed by a `main` merge.
