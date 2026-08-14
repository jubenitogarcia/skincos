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
  `/usr/local/sbin/skincos-provision-global-coordination` and
  `/usr/local/sbin/skincos-meta-ads-tracking-custody <named-action>` entries
  through passwordless sudo; neither accepts a caller-selected path, shell, or
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

## Meta Ads release actions

Before any Meta Ads checkpoint, source promotion, apply, restore, rollback,
preflight, or Graph readback, the production `Deploy Token Vault` job must
stream a GitHub OIDC JWT to the helper's `attest` action. Its audience must be
`skincos-meta-ads-tracking-custody/v1/release/<candidate-40-sha>`; the installed
root-owned verifier accepts only that candidate-bound audience, GitHub's fixed
issuer, repository, `main` workflow ref, `production` environment, self-hosted
runner, and the exact first-attempt run id. The OIDC `sha` remains the workflow
source SHA and is intentionally not required to equal the candidate: the
promotion gate may authorize an immutable main ancestor. The candidate is
instead bound by the audience plus the verified staged release identity and
direct lineage. It writes a short-lived approval record bound to that run and
immutable release SHA. Every subsequent named action consumes the same
release/run/attempt binding; an arbitrary job on the runner cannot call a Meta
mutation directly. The JWT is accepted only via stdin and is never printed or
written to an approval record. A later compensation step may stream a fresh
JWT for the same candidate/run/attempt when the short OIDC approval expires;
it cannot refresh approval for a different release.

`promote-native` receives only candidate SHA, run id, attempt, and the
literal recovery flag. It derives the prior release from the candidate's
immutable lineage and invokes the candidate's fixed
`promote-native-source-release.sh`; it cannot select an arbitrary predecessor
or pointer path. Before promotion, `checkpoint-current` accepts the same
candidate/run/attempt record, proves candidate→current direct lineage, and
returns only the current SHA, inactive workflow version, and controlled
checkpoint path. `discover-current` performs the same proof without exporting.
After a controlled source rollback, `preflight-rollback` may validate only that
same direct predecessor while it is current. `rollback-native` remains
separately lineage-gated. If an inner workflow apply exits after a potential
database change, the helper exports the resulting state and restores its own
immediate private checkpoint before reporting a compensated failure; unreadable
state remains an explicit fail-closed error.

`promote-and-apply` is the bounded production transaction for the normal
candidate path. Its strict stdin record is candidate SHA, run id, first attempt,
expected inactive Orb version, and a literal recovery flag. It validates the
candidate OIDC approval once before any pointer mutation, captures its private
pre-write checkpoint, promotes only the direct staged successor, and applies the
version-locked inactive workflow from that exact source. Success returns only
the candidate/current SHA, direct prior SHA, and applied workflow version. A
known no-write or internally restored apply failure rolls the pointer back to
that direct prior and runs the prior strict preflight before returning a
non-success result; an unreadable or otherwise ambiguous post-apply state keeps
the candidate fail-closed and reports no success JSON. This prevents a short
OIDC approval from expiring between a successful pointer transition and its Orb
apply, without extending approval to another release or arbitrary operation.

## Routine flow

1. Dispatch `.github/workflows/provision-native-global-coordination-custody.yml`
   from `main`.
2. The workflow acquires `global:orb-coordination-custody` and checks its
   fencing proof before the write.
3. The workflow streams the active GitHub secret and public key id directly to
   the root helper; no step echoes or serializes the value.
4. The helper writes
   `/etc/skincos/global-coordination/orb-backup.env` with mode `0640`, owner
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
