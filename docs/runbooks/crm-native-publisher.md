# CRM native publisher — custody and bootstrap contract

## Status

This repository contains a **dispatch-only, root-custodied production
publisher** for a dedicated immutable CRM release. It remains inert until a
host administrator installs the non-secret helper and a separate root-owned
policy pins the exact candidate, staging receipt, host-runtime attestation and
public signing key. No release is published merely by merging this source.

The purpose is to stop treating the shared pointer
`/opt/skincos/current/source` as the CRM release boundary. The eventual
dedicated unit must instead resolve exactly:

```text
/opt/skincos/current/crm-service
  -> /opt/skincos/releases/<source-sha>/crm-service
```

The shared source pointer remains owned by its existing publisher and is never
modified by this publisher. Cloudflare Pages/Workers, domain data, databases,
route migrations and legacy-writer retirement remain separately governed.

## What is implemented now

| Component | Contract |
| --- | --- |
| `ops/runtime/units/crm.service` | Remains the incumbent shared-source unit until the dedicated bootstrap succeeds; this avoids changing a live service before its isolated pointer exists. |
| `.github/workflows/publish-crm-native-release.yml` | Manually dispatched protected-environment workflow. It accepts only the current `main` SHA and an exact `release-source-<sha>` artifact. |
| `crm-native-source-bundle.mjs` | Extracts only an allow-listed CRM source closure from the generic monorepo artifact; unrelated entries are never materialized. |
| `crm-native-publisher-claims.mjs` | Checks a short-lived signed authorization bound to source, staging/runtime receipts, incumbent state and the global coordination fence. |
| `crm-native-publisher-custody.mjs` | Root-only helper which receives a bounded stdin frame, builds an immutable release, atomically switches the dedicated pointer and `crm.service`, then verifies PID/cwd/environment/health. |
| `install-crm-native-publisher-custody.sh` | Installs only the non-secret helper, literal sudoers rule and runner mount-namespace update. It does not install policy or restart `crm.service`. |
| `rollback-last` | Root-only recovery command which restores the captured unit, drop-ins and dedicated pointers, then restarts only `crm.service`. |
| `crm-native-release-contract.mjs` | Strictly validates identity metadata, custody fields, fixed target layouts, symbolic links, hard links, special files and pointer confinement. |
| `test-crm-native-publisher.sh` | Executes the source-level pointer protocol in an isolated `/tmp/skincos-crm-native-test-*` directory. |

The source closure is `crm/api`, `crm/console`, `shared/crm-auth`, the API
launcher, backend environment helper and capabilities catalog. Production Node
dependencies are installed from the exact lockfile in the runner, archived
separately, and checked with `npm ls --omit=dev --all` before and after a fresh
archive extraction. npm's `.bin` links are materialized as bounded regular
copies before archiving, so the final dependency closure contains no links.
The archive also contains a canonical dependency manifest with the API
package/lock digests, direct dependencies, every final path/type/mode and file
digest. Its digest and byte count are signed with the archive and checked again
by the root helper after root-owned mode normalization. No host-side `npm
install` or caller-selected path is permitted.

The source-level prepare/rollback scripts still allow an explicitly enabled
**test** harness only. Staging/production mutation belongs exclusively to the
root custody helper; a self-consistent JSON file is not evidence that GitHub
released a candidate.

## Fixed layouts

The source contract recognizes test and staging layouts; the root publisher
also recognizes the fixed production layout:

| Target | Releases | Active pointer | Previous pointer |
| --- | --- | --- | --- |
| `test` | `/tmp/skincos-crm-native-test-<id>/releases` | `/tmp/skincos-crm-native-test-<id>/current/crm-service` | `/tmp/skincos-crm-native-test-<id>/current/crm-service.previous` |
| `staging` | `/opt/skincos/staging/releases` | `/opt/skincos/staging/current/crm-service` | `/opt/skincos/staging/current/crm-service.previous` |
| `production` | `/opt/skincos/releases` | `/opt/skincos/current/crm-service` | `/opt/skincos/current/crm-service.previous` |

The source-level scripts continue to reject production mutation. The root
publisher alone recognizes that layout. `/opt/skincos/current/source`, arbitrary
release roots, mounts under `/mnt`, and a regular file in place of a pointer are
rejected.
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
  "target": "test-or-staging-or-production",
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

The complete schema's new `runtimeCustody.schemaVersion: 2` also binds the
separate dependency archive and its internal manifest, policy, staging/runtime
receipts, signed authorization, rendered unit and coordination fence. Existing
schema-version 1 releases remain readable only as rollback/inspection targets;
new native publishes require version 2. It fixes the API entrypoint, API
lockfile and console root. The candidate is recursively rejected if it contains
a symbolic link, hard link, special file or final Linux file capability. This
keeps the native materialization boundary distinct from a checkout, worktree,
Windows mount, `.env`, database dump or runtime state.
When an active release exists, the candidate's `predecessor` must bind both its
immutable release SHA and source tree. An initial release must declare no
predecessor. The test harness verifies this chain before any copy or pointer
mutation, so rollback cannot be attached to an unrelated incumbent.

Before a production transfer can execute, a root-owned, fixed-command custody helper must
verify the real GitHub artifact and bind all of the following together:

1. GitHub repository, workflow run and immutable `main` SHA;
2. source tree and source archive SHA-256;
3. the native, non-symlink candidate directory and its exact predecessor;
4. a global coordination lease scoped to the CRM service release;
5. the intended native unit and an independently captured rollback target.

No GitHub Environment variable, shell argument, local marker file, secret or
self-authored receipt substitutes for that verifier. Secret values and customer
rows are never included in this contract or its release metadata.

## Pointer, service transfer and rollback protocol

The root helper performs this confined sequence after it receives a valid signed
frame:

1. Verify the root-private policy, authorization, fresh incumbent digest and
   the global coordination lease.
2. Copy the exact source/dependency archives into a private state directory;
   reject unsafe archive members, duplicate members, links, special files and
   final Linux file capabilities. The dependency manifest must match the
   signed digest, package/lock inputs and every extracted dependency byte
   before release metadata is written.
3. Materialize and revalidate `<sha>/crm-service` under the fixed production
   release base. Existing immutable releases are never overwritten.
4. Snapshot the incumbent unit, allowed drop-ins and dedicated pointers in a
   root-private journal. Redirecting drop-ins fail closed.
5. Revalidate the incumbent and coordination lease immediately before atomic
   pointer/unit replacement. The helper writes `crm-service.previous`, then
   `crm-service`; it never writes the shared source pointer.
6. Reload systemd, restart only `crm.service`, and verify its PID, cwd
   `<release>/crm/api`, fixed environment and local `/health` response.
7. On any failure after the snapshot, restore the unit, drop-ins and dedicated
   pointers, reload systemd and restart the original service. A later root-only
   `rollback-last` uses the same captured transaction.

The dedicated unit reasserts `PONTO_LEGACY_RUNTIME_MODE=disabled` after both
private environment layers. The legacy service remains the rollback target until
the native unit has passed its transactional health verification.

The first native closure intentionally lacks the Python sales-chart runtime;
`sales-chart-messenger` therefore returns `503` in native mode instead of
falling back to mutable host state. Its media mode comes from the root policy.
The initial policy should use `disabled` unless a separate host-runtime receipt
proves the required fixed binaries and intended MediaMTX transition. With that
mode, media proxy/execution routes return `503`; it does not claim to remove
unrelated routes or host processes.

## External bootstrap and production gates

No secret, customer data, raw token or external receipt is stored in Git. Before
dispatching the workflow, the operator must provide:

- a reviewed root-owned policy at
  `/etc/skincos/crm-native-publisher/policy.json`, mode `0600`, pinning the
  exact source artifact, staging proof, runtime attestation, Ed25519 public key
  and archive bounds;
- protected GitHub Environment `crm-native-publisher-production` with the
  signing private key, signing-key ID, staging proof digest and runtime
  attestation digest;
- the existing production global-coordination configuration in GitHub and the
  root-owned host custody file;
- the exact `release-source-<sha>` artifact, a `main` checkout of that SHA, and
  root-owned fixed release/current/state/config paths; and
- an approved staging proof, per-domain projection/backfill evidence,
  single-publisher decision and legacy retirement plan.

The installer must be executed by a host administrator from a reviewed release
tree rooted in a physical `root:root` path. During `--apply` it rejects a
non-root-owned, group/world-writable, symbolic-link or hard-linked source
closure; it also requires every source path to stay on one approved native
local mount (`ext4`, `xfs`, `btrfs`, `zfs` or `f2fs`) with filesystem root `/`,
no `/mnt` target and no reported bind option. This rejects Windows/DrvFS/9p,
network/FUSE/overlay mounts and nested mount redirects. It stops ancestor
ownership traversal at that verified mountpoint so a separately mounted safe
release tree is not rejected merely because its parent is on another device.

`--verify-apply-source` performs those representation checks without changing
the host. `--apply` repeats them, copies the exact installer closure through
no-follow descriptors into a root-private staging directory, records SHA-256
for every staged input and rechecks those digests immediately before installing
any helper/unit/sudoers file. The root-only bootstrap still requires the
administrator to begin from a reviewed canonical source path; a shell script
cannot make a malicious file trusted after it has already been invoked. It
updates the custody-runner mount namespace to permit only the fixed CRM
transaction paths, then restarts that runner — never `crm.service`.
Policy bootstrap and `rollback-last` are root-only; the GitHub runner receives
sudo permission only for literal `preflight` and `publish` commands.

`systemd`, `curl`, GNU `tar`, Node, `systemd-analyze`, `visudo` and
`/usr/sbin/getcap` must be present on the custody runner host. The publisher
does not create a Cloudflare deployment, production database, route migration,
data backfill or a writer-retirement approval.

## Local validation

Run from an isolated worktree through the WSL gateway:

```powershell
.\scripts\invoke-skincos-wsl.ps1 `
  -ProjectRoot (Get-Location).Path `
  -Executable bash `
  -Argument @('-lc', 'npm run crm:native-publisher:test')
```

The validation creates and removes only a `/tmp/skincos-crm-native-test-*`
fixture. It checks claims, the signed dependency-manifest closure (including
altered/extra/missing/link/hard-link/lockfile/direct-dependency failures),
archive selection, rendered unit syntax and the isolated pointer protocol. It
also verifies that a mutable local source representation cannot pass the
installer preflight. It does not install the helper, read a secret, contact a
coordinator, alter a host or dispatch production.
