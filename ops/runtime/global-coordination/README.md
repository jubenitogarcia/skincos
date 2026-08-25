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
refuses an acquire/check without a detached closure attestation. Module release
wrappers install those attestations as
`.skincos-global-coordination-<module>.json` inside the immutable release.

The runtime must provide these names through its private environment or secret
store; values never belong in this repository:

- `SKINCOS_GLOBAL_COORDINATOR_URL`
- `SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET`
- `SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY` and `SKINCOS_GLOBAL_COORDINATION_KEY_ID`
  during an explicit key rotation; these replace the legacy secret record when
  the key id is not `legacy-v1`;
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

The immutable runtime wrappers use this adapter for SKINCOS-owned
Atendimento provisioning/control/migration and lifecycle service mutations.
Orb release, backup and MCP operations are owned by the independent Orb
repository. The default file is
`/etc/skincos/global-coordination/native-runtime.env`, mode `0600` or `0640`, and
may contain only the coordinator URL plus either the legacy shared-secret
record or the active-key/key-id pair. It is never stored in the repository or
copied to Windows.
