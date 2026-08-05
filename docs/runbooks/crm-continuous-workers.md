# CRM continuous workers

The Clientes/Harmonia continuous worker is a separate process from the CRM HTTP
API. The API registers decision and ingestion routes only; it never starts a
background worker as a side effect of serving HTTP traffic.

## Safety contract

`CRM_CONTINUOUS_WORKERS_MODE` (or the legacy `HARMONIA_WORKER_MODE`) accepts:

- `disabled`: no polling; readiness is not available.
- `observe`: read-only queue statistics. It never claims, completes, retries,
  cleans up or sends a message. This is the default runtime mode.
- `assisted`: processes queued tasks, but every outbound task must contain a
  structured `humanConfirmation` object with `status=confirmed`, a non-empty
  `approvedBy`, a valid `approvedAt` timestamp and a stable `idempotencyKey`.
  The provider receives that key as `x-idempotency-key`.

The legacy `HARMONIA_WORKER=1` flag maps only to `observe`. Unknown values and
missing enablement fail closed. `CRM_CONTINUOUS_WORKERS_ASSISTED_CONFIRMED=1`
is a second, explicit gate for assisted mode and is never enabled by the unit
template. No production commercial write, consent mutation, campaign action or
external message is authorized by this worker foundation.

## Runtime and health

The dedicated entrypoint is `crm/api/continuous-worker.js`; the native launcher
is `scripts/crm/run-continuous-workers-linux.sh`. The unit template is
`ops/runtime/units/crm-jobs.service`. Install/render it with
`scripts/runtime/install-continuous-worker-service.sh`; the installer does not
start the service. Private `crm-jobs.env` is the only place to enable a runtime.

The health server binds to loopback by default (`CRM_CONTINUOUS_WORKER_PORT`,
default `8102`) and exposes:

- `GET /health`: liveness and redacted worker state, always HTTP 200 while the
  process is serving;
- `GET /readiness`: HTTP 200 only after the configured database has answered a
  worker loop, otherwise HTTP 503;
- all other paths: HTTP 404.

Status reports mode, outbound policy, dependency reachability, queue counts and
last loop/error timestamps. It does not expose task payloads, phone numbers,
tokens or provider responses.

## Rollback and promotion

Before installing a unit, preserve the current unit file and record the
release/source path. Roll back by restoring that unit, running `systemctl
daemon-reload`, and leaving `CRM_CONTINUOUS_WORKERS_ENABLED=0` until health and
readiness evidence is reviewed. A runtime promotion must use an isolated,
verified release and a synthetic/read-only observation window first. Do not
switch to `assisted` or send a real message from a diagnosis or health check.

Suggested checks:

```sh
scripts/runtime/install-continuous-worker-service.sh
systemctl status crm-jobs.service --no-pager
curl --fail http://127.0.0.1:8102/health
curl --fail http://127.0.0.1:8102/readiness
```

The final two checks are expected to fail readiness when the service is disabled
or the database is unavailable; that is a safety signal, not proof of a deploy.

## Schema gate

The worker foundation does not auto-create production tables. The additive
Harmonia schema migration is explicit and target-bound:

```sh
HARMONIA_MIGRATION_TARGET=staging \
HARMONIA_MIGRATION_ACTION=dry-run \
scripts/runtime/run-harmonia-migration-native.sh

HARMONIA_MIGRATION_TARGET=staging \
HARMONIA_MIGRATION_ACTION=apply \
scripts/runtime/run-harmonia-migration-native.sh
```

The native launcher loads only the private target environment, rejects a
wrong database/user/transport, takes an advisory lock, records an aggregate
checkpoint under `/var/backups/skincos/clientes`, applies the existing additive
Harmonia DDL idempotently, seeds only the two bounded unit definitions, and
records `20260805_harmonia_worker_foundation_v1`. It never drops, truncates or
deletes data. Rollback is operational: stop/disable the worker and retain the
schema and checkpoint; do not issue a destructive reverse migration.

Production uses PostgreSQL peer authentication and therefore must run as the
native `skincos` OS user. Provision the checkpoint directory once as root with
group write for that service identity, then run the native launcher as
`skincos`; the launcher refuses arbitrary backup roots or a different OS user:

```sh
sudo install -d -o root -g skincos -m 0770 /var/backups/skincos/clientes
sudo -u skincos env \
  HARMONIA_MIGRATION_TARGET=production \
  HARMONIA_MIGRATION_ACTION=dry-run \
  /opt/skincos/current/source/scripts/runtime/run-harmonia-migration-native.sh
```

An apply follows the same command with `HARMONIA_MIGRATION_ACTION=apply`.
Staging uses its dedicated migrator environment and the separate
`/var/backups/skincos/clientes/staging` checkpoint root.
