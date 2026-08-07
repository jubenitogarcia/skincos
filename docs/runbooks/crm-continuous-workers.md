# CRM continuous workers

The Clientes/Harmonia continuous worker is a separate process from the CRM HTTP
API. The API registers decision and ingestion routes only; it never starts a
background worker as a side effect of serving HTTP traffic.

## Safety contract

`CRM_CONTINUOUS_WORKERS_MODE` (or the legacy `HARMONIA_WORKER_MODE`) accepts:

- `disabled`: no polling; readiness is not available.
- `observe`: read-only queue statistics. It never claims, completes, retries,
  cleans up or sends a message. This is the default runtime mode.
- `assisted`: deliberately unavailable in this process. The native launcher
  exits before startup and an in-process request is pinned to `observe`.
  Human click-to-send remains a separately revalidated CRM transaction; a
  continuous worker can never turn it into autonomous delivery.

The legacy `HARMONIA_WORKER=1` flag maps only to `observe`. Unknown values and
missing enablement fail closed. An unrecognized mode disables both Harmonia
polling and the scheduled jobs. No production commercial write, consent
mutation, campaign action or external message is authorized by this worker
foundation.

The independent job runner is controlled separately by
`CRM_CONTINUOUS_JOBS_ENABLED`. It registers four jobs with independent timers:

| Job | Responsibility | Default interval | Failure handling |
| --- | --- | ---: | --- |
| `clientes.opt_out_ingestion` | Aggregate opt-out snapshot from `harmonia.contacts`; no phone payload is copied | 60 s | retry/backoff, then checkpoint dead-letter |
| `clientes.source_update` | Target-bound Google Sheets source refresh; unit defaults to `dry-run` | 15 min | advisory lock, retry/backoff, then dead-letter |
| `clientes.quality_refresh` | Refresh the Atendimento commercial data-quality queue | 30 min | target/identity gate, retry/backoff, then dead-letter |
| `clientes.clinical_approval_expiry` | Materialize only already-due clinical-rule expirations | 15 min | disabled by default; local/staging target only; permanent configuration rejection goes straight to dead-letter |

Each execution has a deterministic `job-id:scheduled-at` idempotency key. The
checkpoint at `CRM_CONTINUOUS_JOBS_STATE_PATH` (default
`$VAR_DIR/continuous-jobs-state.json`) retains the last execution, duration,
lag, error/retry counts, next run and up to 100 dead-letter entries. A
permanent failure keeps readiness at `503` until an operator reconciles or
resets that job; it is never retried forever.

The checkpoint is a mandatory precondition, rather than best-effort telemetry:
before a job invokes an adapter it persists `pendingExecutionKey` atomically.
The service holds an exclusive sibling lock (`.lock`) for its whole lifetime.
If either state load, write or lock acquisition fails, it schedules no job and
returns readiness `503` while retaining liveness. A controlled SIGTERM keeps a
retryable failed execution pending for the next verified start; it never turns
that shutdown race into a dead-letter.

## Runtime and health

The dedicated entrypoint is `crm/api/continuous-worker.js`; the native launcher
is `scripts/crm/run-continuous-workers-linux.sh`. The unit template is
`ops/runtime/units/crm-jobs.service`. Install/render it with
`scripts/runtime/install-continuous-worker-service.sh`; the installer does not
start the service. Private `crm-jobs.env` is the only place to enable a runtime.
The launcher does not source either environment file and never runs `npm
install`; systemd supplies `EnvironmentFile` values and dependencies must be
provisioned by the release. No variable or GitHub Environment is interpreted as
shell. Applying a unit also requires an explicit immutable
`/opt/skincos/releases/<40-hex-sha>/source` path; systemd destination, config,
state, log and backup paths are fixed by the installer.

Activation is deliberately two-keyed in the private environment:
`CRM_CONTINUOUS_WORKERS_ENABLED=1` starts the process and
`CRM_CONTINUOUS_JOBS_ENABLED=1` enables the Clientes jobs. The checked-in unit
keeps both disabled by default and keeps source refresh at `dry-run`. Clinical
expiry needs the additional `CLINICAL_APPROVAL_EXPIRY_JOB_ENABLED=1`, a
`CLINICAL_APPROVAL_EXPIRY_TARGET` of `local` or `staging`, and the clinical
domain's own explicit enablement. It refuses `production` and a read-only
runtime before opening the clinical store; it never approves, recommends or
sends anything.

The health server binds to loopback by default (`CRM_CONTINUOUS_WORKER_PORT`,
default `8102`) and exposes:

- `GET /health`: liveness and redacted worker state, always HTTP 200 while the
  process is serving;
- `GET /readiness`: HTTP 200 only after the configured database has answered a
  worker loop, otherwise HTTP 503;
- all other paths: HTTP 404.

Status reports mode, outbound policy, dependency reachability, queue counts and
last loop/error timestamps. The job section reports lag, last execution,
duration, errors, retries and dead-letter count. It does not expose task
payloads, phone numbers, tokens or provider responses. The health interface is
loopback-only (`127.0.0.1` or `::1`); non-loopback hosts are rejected at
startup. `/health` remains `200` while the process is alive even when the
database is unavailable. `/readiness` is `503` until database, Harmonia queue,
job checkpoint and required jobs are healthy.

## Rollback and promotion

This tranche intentionally performs no production promotion, unit enablement,
database migration or external message. It delivers the isolated code,
templates, tests and evidence only.

Before installing a unit, preserve the current unit file and record the
release/source path. Roll back by restoring that unit, running `systemctl
daemon-reload`, and leaving `CRM_CONTINUOUS_WORKERS_ENABLED=0` until health and
readiness evidence is reviewed. A runtime promotion must use an isolated,
verified release and a synthetic/read-only observation window first. Do not
attempt `assisted` in this service or send a real message from a diagnosis or
health check.

Suggested checks:

```sh
scripts/runtime/install-continuous-worker-service.sh
systemctl status crm-jobs.service --no-pager
curl --fail http://127.0.0.1:8102/health
curl --fail http://127.0.0.1:8102/readiness
```

The final two checks are expected to fail readiness when the service is disabled
or the database is unavailable; that is a safety signal, not proof of a deploy.

For a local real-process smoke (including database-down health, readiness `503`,
SIGTERM and port release), run:

```sh
node scripts/tests/clientes-continuous-worker-smoke.mjs
```

The smoke uses no production credentials and does not enable a write or an
external provider.

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
sudo setfacl -m u:skincos:--x /var/backups/skincos
sudo -u skincos env \
  HARMONIA_MIGRATION_TARGET=production \
  HARMONIA_MIGRATION_ACTION=dry-run \
  /opt/skincos/current/source/scripts/runtime/run-harmonia-migration-native.sh
```

An apply follows the same command with `HARMONIA_MIGRATION_ACTION=apply`.
Staging uses its dedicated migrator environment and the separate
`/var/backups/skincos/clientes/staging` checkpoint root.

## Superseded implementation

PR #736 (`codex/admin/jobs-worker-foundation`) was a stale draft based on an
older main line and is not incorporated. Its valid process-boundary idea was
reimplemented on the current `origin/main` by the merged foundations in PRs
#1121/#1122 and this additive job-runner change. The old PR must remain closed
as superseded; do not merge or rebase its branch into this runtime.
