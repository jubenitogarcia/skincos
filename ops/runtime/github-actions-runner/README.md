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
