# CRM native publisher — custody and bootstrap contract

## Status

This is a **source-only contract** for a future CRM-only native publisher. It
does not install a unit, copy a release to a host, restart `crm.service`,
change a Cloudflare route, migrate data, or enable/disable a legacy writer.
Production is intentionally not an accepted target.

The purpose is to stop treating the shared pointer
`/opt/skincos/current/source` as the CRM release boundary. The eventual
dedicated unit must instead resolve exactly:

```text
/opt/skincos/current/crm-service
  -> /opt/skincos/releases/<source-sha>/crm-service
```

The shared source pointer remains owned by its existing publisher and is never
modified by these scripts.

## What is implemented now

| Component | Contract |
| --- | --- |
| `ops/runtime/units/crm.service` | Declares only `/opt/skincos/current/crm-service` for the CRM runtime code, console and backend paths. |
| `prepare-crm-native-release.sh` | Validates a CRM source snapshot, materializes it under `<release-base>/<sha>/crm-service`, and swaps only the dedicated pointer. |
| `rollback-crm-native-release.sh` | Restores only the exact release named by `crm-service.previous`; it does not infer a checkout or mutate the shared source pointer. |
| `crm-native-release-contract.mjs` | Strictly validates source identity metadata, custody fields, the fixed target layouts, no symbolic links in a candidate, and pointer confinement. |
| `test-crm-native-publisher.sh` | Executes the pointer protocol in an isolated `/tmp/skincos-crm-native-test-*` directory. It proves no service restart is attempted. |

The sole executable mutation is an explicitly enabled **test** harness. A
`staging --apply` request fails before opening candidate bytes because no
external authenticated custody verifier exists yet. This is deliberate: a
self-consistent JSON receipt is not evidence that GitHub released a candidate.

## Fixed layouts

Only two layouts are recognized:

| Target | Releases | Active pointer | Previous pointer |
| --- | --- | --- | --- |
| `test` | `/tmp/skincos-crm-native-test-<id>/releases` | `/tmp/skincos-crm-native-test-<id>/current/crm-service` | `/tmp/skincos-crm-native-test-<id>/current/crm-service.previous` |
| `staging` | `/opt/skincos/staging/releases` | `/opt/skincos/staging/current/crm-service` | `/opt/skincos/staging/current/crm-service.previous` |

`production`, `/opt/skincos/current/source`, arbitrary release roots, mounts
under `/mnt`, and a regular file in place of a pointer are rejected.
For a test mutation, the named `/tmp/skincos-crm-native-test-*` root must
already be a real directory and each existing release/current ancestor must be
a real directory too; a symbolic-link redirect is rejected before candidate
bytes are read or a directory is created.

## Release custody contract

A materialized CRM release must contain
`.skincos-crm-native-release.json`, with only non-secret identity fields:

```json
{
  "schemaVersion": 1,
  "kind": "skincos-crm-native-release",
  "releaseSha": "<40-lowercase-hex>",
  "sourceTree": "<40-lowercase-hex>",
  "sourceArchiveSha256": "<64-lowercase-hex>",
  "target": "test-or-staging",
  "custody": {
    "issuer": "github-actions",
    "repository": "jubenitogarcia/skincos",
    "workflow": "prepare-release-candidate.yml",
    "runId": "<numeric-run-id>",
    "artifactName": "release-source-<same-sha>",
    "sourceSha": "<same-sha>",
    "sourceArchiveSha256": "<same-digest>"
  }
}
```

The complete schema also fixes the API entrypoint, API lockfile and console
root. The candidate is recursively rejected if it contains a symbolic link or
special file. This keeps the native materialization boundary distinct from a
checkout, worktree, Windows mount, `.env`, database dump or runtime state.

Before staging can execute, a root-owned, fixed-command custody helper must
verify the real GitHub artifact and bind all of the following together:

1. GitHub repository, workflow run and immutable `main` SHA;
2. source tree and source archive SHA-256;
3. the native, non-symlink candidate directory and its exact predecessor;
4. a global coordination lease scoped to the CRM service release;
5. the intended staging unit and an independently captured rollback target.

No GitHub Environment variable, shell argument, local marker file, secret or
self-authored receipt substitutes for that verifier. Secret values and customer
rows are never included in this contract or its release metadata.

## Pointer protocol

After custody succeeds, the publisher will use the following confined sequence:

1. Validate the source identity and candidate under the fixed native release
   base.
2. Copy it to a sibling staging directory and revalidate it.
3. Rename that directory to `<sha>/crm-service`; existing immutable releases
   are never overwritten.
4. Create a temporary `crm-service.previous.next-*` link to the active target
   and atomically rename it to `crm-service.previous`.
5. Create a temporary `crm-service.next-*` link to the new target and atomically
   rename it to `crm-service`.
6. Re-read the dedicated pointer and prove it resolves to the expected immutable
   CRM release.

No command restarts a service. A later host rollout must separately snapshot the
active CRM service, render/verify the unit, restart only `crm.service`, verify
PID/cwd/release identity and synthetic health/readiness, and compensate by
restoring the dedicated predecessor pointer if that smoke fails.

`scripts/runtime/manage-native-runtime.sh restart` intentionally excludes
`crm.service` (and the isolated Atendimento units). It may restart only the
remaining shared services under their shared-source lease; it cannot become an
accidental CRM cutover mechanism. Its `validate` command likewise reports only
the shared units; it no longer runs a shared-source CRM smoke and pretends that
it attested the dedicated release.

For the same reason, `install-lifecycle-units.sh --apply` deliberately excludes
`crm.service`. A future custody-bound CRM publisher must render and install that
unit as part of its own verified transaction; the generic lifecycle installer
must never install a dedicated CRM unit under a shared-source lease.

## Bootstrap still required for staging

The staging owner must provide a separate reviewed bootstrap before enabling
`--apply`:

- native filesystem and root-owned `/opt/skincos/staging` hierarchy;
- least-privilege ownership for release files, private config and runtime state;
- fixed-command custody helper with no arbitrary shell, path or systemctl input;
- coordination closure/lease and durable sanitized release journal;
- a verified incumbent `crm-service` pointer and rollback target;
- dedicated staging service configuration, synthetic health/readiness probe and
  post-rollback smoke;
- confirmation that no shared CRM service, route, database or legacy writer is
  changed by the staging operation.

Only after the complete staging proof can a separate production cutover proposal
be evaluated. It still requires the existing route, data projection/backfill,
writer retirement, single-publisher and rollback gates; this contract grants
none of those changes.

## Local validation

Run from an isolated worktree through the WSL gateway:

```powershell
.\scripts\invoke-skincos-wsl.ps1 `
  -ProjectRoot (Get-Location).Path `
  -Executable bash `
  -Argument @('scripts/runtime/test-crm-native-publisher.sh')
```

The test creates and removes only a `/tmp/skincos-crm-native-test-*` fixture.
It must not be substituted for staging validation or a production release.
