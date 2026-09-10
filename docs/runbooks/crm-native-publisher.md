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
| `ops/runtime/units/crm.service` | Remains the incumbent shared-source unit until the dedicated bootstrap succeeds; this avoids changing a live service before its isolated pointer exists. |
| `ops/runtime/units/crm.service.native.template` | Is the non-installed template for the future dedicated unit. It takes an explicit native release root and deployment target; the generic lifecycle installer does not render it. |
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
When an active release exists, the candidate's `predecessor` must bind both its
immutable release SHA and source tree. An initial release must declare no
predecessor. The test harness verifies this chain before any copy or pointer
mutation, so rollback cannot be attached to an unrelated incumbent.

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
active CRM service, render/verify `crm.service.native.template`, replace the
incumbent unit and shared lifecycle ownership in the same custody-bound
transaction, restart only `crm.service`, verify PID/cwd/release identity and
synthetic health/readiness, and compensate by restoring the dedicated
predecessor pointer if that smoke fails.

Until that transaction succeeds, `scripts/runtime/manage-native-runtime.sh` and
`install-lifecycle-units.sh --apply` keep managing the incumbent `crm.service`
from the shared source. They must not be changed to assume a dedicated pointer
merely because this source contract exists. The native template is deliberately
outside the generic installer's unit list; the custody-bound CRM publisher must
render, verify and install it as part of one transaction.

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

The bootstrap must leave the incumbent unit and shared lifecycle behavior intact
if any of those checks fail. Only after the native pointer, dedicated template,
CRM-only restart and smoke have all succeeded may it transfer `crm.service`
away from the shared-source publisher.

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
