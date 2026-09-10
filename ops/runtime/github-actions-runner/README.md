# Trusted native custody runner

This runner is the canonical GitHub-to-mini-PC custody bridge for native
runtime secrets and reversible release operations. It is deliberately separate
from the `skincos` service account and is never used by pull-request workflows.

## Contract

- runner user: `skincos-actions` with a non-login shell;
- runner label: `skincos-native-custody` together with the standard Linux/X64
  labels;
- runner root: `/var/lib/skincos-runtime/github-actions-runner`;
- only dispatches from the trusted `main` ref may target this label;
- the repository workflow must check the exact `github.sha` against `main` and
  must not accept `pull_request`, fork, or arbitrary ref execution;
- the user may invoke only the fixed
  `/usr/local/sbin/skincos-provision-global-coordination` entry through
  passwordless sudo; it does not accept a caller-selected path, shell, or
  extra command argument;
- the helper accepts the coordinator URL, one coordination secret and a public
  key id only through stdin, validates the bounded contract, writes an atomic
  root-owned file, and never prints any secret value;
- the separate `/usr/local/sbin/skincos-capture-ponto-legacy-snapshot capture`
  command is available only to `skincos-actions`. It accepts one signed,
  short-lived authorization on stdin, reads only the two fixed legacy Ponto
  state files, writes the raw pair only into root-private backup storage, and
  returns a sanitized receipt. It is not a general filesystem reader, importer,
  service controller, or Ponto JIT capability;
- the separate `/usr/local/sbin/skincos-attest-ponto-legacy-absence
  attest-absence` command is available only to `skincos-actions`. It accepts a
  distinct signed, short-lived authorization on stdin and is bound by a
  separate root-owned policy to `crm.service`, `disabled`, an immutable native
  release SHA/metadata, release hashes and the fixed legacy pair. It verifies
  the native process cgroup, command, working directory, start time and safe
  environment twice around the fixed `lstat ENOENT` observations, writes a
  root-private one-use ledger, and returns a root-Ed25519-signed sanitized
  point-in-time receipt. It cannot bootstrap policy, select a path, read file
  content, restart a service, import data, or invoke a publisher;
- the runner workspace and credentials stay on native Linux storage and are
  not copied to Windows, the repository, artifacts, or logs.

The one-time runner registration token is consumed by
`scripts/runtime/install-native-custody-runner.sh`. The canonical Windows
entrypoint `scripts/bootstrap-native-custody-runner.ps1` obtains that token
only when the local identity is absent and sends it through the typed WSL
gateway's in-memory, BOM-free stdin transport. It is not persisted by the
bootstrap script or emitted as a Windows argument, file, log, artifact, or
workflow output. The upstream `config.sh` necessarily receives it as a
short-lived local process argument during registration. The runner's own
registration credential remains in its private service directory and is not a
repository secret or a workflow output.

The systemd unit keeps `ProtectSystem=strict` and the narrow sudoers commands.
It deliberately does not set `NoNewPrivileges=true`, because that would make
the fixed root helpers impossible to execute. Its named writable mounts are
created by the installer and remain POSIX-private from `skincos-actions`; the
helpers still own every atomic write and metadata validation.

## Independent Orb custody

Orb release, workflow export/parity, PostgreSQL backup/restore and n8n
encryption-key custody are owned by
[the independent Orb repository](https://github.com/jubenitogarcia/orb).
This SKINCOS runner does not publish, restart or mutate Orb. The public
`orb.skincos.com.br` health endpoint is an observation signal only.
## Routine flow

1. Dispatch `.github/workflows/provision-native-global-coordination-custody.yml`
   from `main`.
2. The workflow acquires `global:native-runtime-coordination-custody` and checks its
   fencing proof before the write.
3. The workflow streams the active GitHub secret and public key id directly to
   the root helper; no step echoes or serializes the value.
4. The helper writes
  `/etc/skincos/global-coordination/native-runtime.env` with mode `0640`, owner
   `root`, and group `admin`, then returns metadata-only audit output.
5. The workflow releases the lease in an `always()` step. Missing runner,
   missing secret, invalid path, stale SHA, or failed audit is fail-closed.

The bridge removes the previous manual GitHub-to-mini-PC copy gap. If an
authenticated GitHub session and native root/platform trust already exist,
runner registration is executable by Codex. An absent `INTERNAL GENERATED
SECRET` follows the autonomy policy and is provisioned when the mission and
canonical-store access permit it; MFA/re-authentication, unavailable external
credential issuance/rotation, or unavailable platform trust remain the only
bootstrap boundaries. Routine rotation and reconciliation are automated through
the same guarded workflow.

## Legacy Ponto snapshot capture

Use `.github/workflows/ponto-legacy-backfill-capture.yml` only after the
root-installed capture helper and its public verifier policy are in place. The
workflow is restricted to the exact current `main` SHA and its dedicated
protected environment. It uploads only a receipt with hashes, byte counts and
aggregate counts; the raw `ponto_store.v2.json` and `ponto_audit.v1.jsonl`
remain `root:root` in the host backup directory and are never copied to the
runner workspace, GitHub artifact, Git repository, or logs.

## Legacy Ponto absence attestation

Use `.github/workflows/ponto-legacy-absence-attestation.yml` only after a root
operator has installed the helper and bootstrapped its separate private policy.
The protected dispatch signs a new Ed25519 authorization bound to the current
`main` SHA and consumes it once. The root helper verifies the fixed active
service PID, its `PONTO_LEGACY_RUNTIME_MODE=disabled` marker, the native release
source metadata, process identity and hashes of the policy-selected wrapper and
Ponto route artifact before requiring `ENOENT` from `lstat` twice for each fixed
legacy name. The uploaded receipt has only authorization/policy/source and run
IDs, PID, mode, artifact hashes and the two absence booleans; it excludes paths,
process command lines, environment values, file content, credentials and PII.

The protected `ponto-legacy-absence-attestation` environment must independently
hold `PONTO_LEGACY_ABSENCE_ATTESTATION_PRIVATE_KEY` and expose only its
authorization key ID, receipt signing key ID/public key and canonical
private-policy SHA-256 as variables. The corresponding receipt private key is
provisioned only by local root bootstrap. The workflow fails if the policy
digest, key IDs, ref, current `main` SHA, run attempt, root receipt signature or
one-use ledger does not match; it must not fall back to the snapshot policy, a
publisher credential, or a manual shell command.

This is an observation, not a release operation. It does not deploy, restart,
delete, capture, import, query D1, reconcile D1, or establish that a file was
absent outside the recorded instant. A missing verified private snapshot leaves
D1 parity unproven and must not be filled with fabricated data.
