# Global coordination runtime adapters

`scripts/codex-global-coordination-workflow.mjs` is the shared operator-facing
adapter for Codex App and the mini-PC. Both callers use the same HTTPS client,
HMAC envelope, owner fields, fencing proof, dependency-closure check and
fail-closed transitions; only `GLOBAL_COORDINATION_PROVIDER` and the private
owner identity differ.

On the mini-PC, call it through the versioned
`scripts/runtime/global-coordination-mini-pc.sh` wrapper. The wrapper forces the
`mini-pc` provider, requires explicit mission/thread/actor identity, keeps proof
files below `/var/lib/skincos-runtime/global-coordination` with mode `0600`, and
refuses an acquire/check without a detached closure attestation. Native source
preparation installs those attestations as
`.skincos-global-coordination-<module>.json` inside the immutable release.

The runtime must provide these names through its private environment or secret
store; values never belong in this repository:

- `SKINCOS_GLOBAL_COORDINATOR_URL`
- `SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET`
- `GLOBAL_COORDINATION_PROVIDER` (`codex` or `mini-pc`)
- `GLOBAL_COORDINATION_MISSION_ID`, `GLOBAL_COORDINATION_THREAD_ID`, and
  `GLOBAL_COORDINATION_ACTOR`

Acquire with `acquire --resource ... --module ... --source ...
--closure-file ... --proof-file ...`, run `renew` while waiting and `check`
immediately before each external mutation, and always run `release` or use
`revoke` only with the separate administrative custody. A local supervisor
lock is not a substitute for this remote proof. If the coordinator URL,
custody, closure, proof or owner identity is unavailable, the native operation
must stop before its first external mutation.

The immutable runtime wrappers use this adapter for the native Orb source
promotion, MCP gateway promotion, verified backup generation, Harmonia
migration, Atendimento provisioning/control/migration and lifecycle service
mutations. The Windows Orb backup publisher invokes
`run-orb-backup-with-coordination.sh`; it does not start the systemd backup
unit directly. The scheduled bridge passes the private WSL environment-file
reference plus a fixed scheduler owner identity. The default file is
`/etc/skincos/global-coordination/orb-backup.env`, mode `0600` or `0640`, and
may contain only the coordinator URL and shared secret names. It is never
stored in the repository or copied to Windows.
