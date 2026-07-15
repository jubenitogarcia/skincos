# Lifecycle runtime cutover

This runbook moves active mutable state into native Linux filesystem roots
without deleting the legacy tree during the change window. It is intentionally
separate from the source-layout pull request: a merged path move is never proof
that a service is safe to rename.

## Current validated checkpoint (2026-07-15)

- A checksum-verified, state-only Orb archive has been extracted into a native
  Linux staging directory. This replaces recursive DrvFS traversal of
  `n8n-home`, which can block WSL in uninterruptible I/O on this host.
- Rollback artifacts are staged at
  `C:\CodexRuntime\artifacts\runtime-cutover\20260714T170200Z` and linked
  only into the retained rollback worktree.
- `C:\CodexRuntime\backups\orb\manual\20260714T233342Z` has a successful
  PostgreSQL restore verification and matching manifest checksum. Incomplete
  `.partial-*` backup attempts were removed after this checkpoint was validated.
- The cutover dry-run, rendered lifecycle units, local health and public Orb/
  CRM health passed. The legacy units remain authoritative until the final
  security-alert triage and scheduled cut window are complete.
- Non-Orb state is pre-copied through a Windows-created TAR and extracted on
  ext4. The first verified transfer contained 9,969 WhatsApp session files,
  CRM state and private runtime configuration; file-count, three session hash
  samples and three private configuration hashes matched without logging a
  credential value. A new final transfer is still required after the legacy
  units stop; a pre-copy is never promoted as the final delta.

## Legacy proxy bridge before the cut

The retained `skincos-orb-proxy.service` runs source-only code and deliberately
does not retain an untracked `node_modules` tree. Until the lifecycle
`orb-proxy.service` replaces it, it needs the pinned n8n runtime modules after
every WSL boot. Keep this narrow, reversible systemd drop-in on the **legacy**
unit:

```bash
sudo install -d -m 0755 /etc/systemd/system/skincos-orb-proxy.service.d
printf '%s\n' '[Service]' \
  'Environment=NODE_PATH=/usr/local/lib/node_modules/n8n/node_modules' \
  | sudo tee /etc/systemd/system/skincos-orb-proxy.service.d/10-runtime-dependencies.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl restart skincos-orb-proxy.service
curl --fail --max-time 10 http://127.0.0.1:8788/healthz
```

This is a compatibility bridge, not a second runtime contract: the rendered
lifecycle `orb-proxy.service` already owns the same `NODE_PATH` setting. Capture
the legacy unit before changing it in
`C:\CodexRuntime\artifacts\runtime-recovery\<timestamp>`. After a successful
cut, the old unit and this drop-in are retired together; do not copy the
drop-in to the lifecycle unit.

## Preconditions

1. The source PR is merged, the canonical checkout is fast-forwarded, and all
   required CI checks are green.
2. A detached rollback worktree exists at the last known-good main commit. Keep
   it until a post-cut verified backup and public smoke are complete. A clean
   worktree is source-only: stage the legacy Livia workflow and CRM production
   dependencies under `C:\CodexRuntime\artifacts\runtime-cutover\<timestamp>`;
   do not put runtime state or dependencies into Git.
3. `skincos-n8n-backup.service` has completed with `VERIFY_RESTORE=1`; record
   the resulting directory under `C:\CodexRuntime\n8n\backups\daily` and
   validate its manifest checksum before the cut.
4. `scripts/runtime/stage-orb-state-archive.sh`,
   `scripts/runtime/prepare-lifecycle-layout.sh`,
   `scripts/runtime/install-lifecycle-units.sh`, and both native release
   launchers pass. The reviewed main SHA is recorded for the native source and
   WhatsApp releases.
5. The window owner has WSL `sudo -n` access. No regular code deploy, D1
   migration or workflow save runs during the window.

## Cut sequence

Run the non-Orb pre-copy before the window; it does not stop services or remove
data. Do **not** use the old generic helper to recurse from `/mnt/c`: this host
has demonstrated blocked I/O when WSL traverses Windows runtime directories.
The PowerShell command reads `C:` natively, writes one TAR through `\\wsl$`,
and the Linux helper extracts and applies it only on ext4:

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\runtime\transfer-lifecycle-state.ps1
```

```bash
scripts/runtime/apply-lifecycle-state-transfer.sh \
  --transfer-root /home/admin/skincos-lifecycle-transfer/<transfer-id> --apply
```

The helper copies from the legacy Windows runtime into these native roots:

- state and caches: `/var/lib/skincos-runtime`;
- private configuration and secrets: `/etc/skincos` (root-owned, group
  readable only by `skincos`);
- logs: `/var/log/skincos`;
- temporary data: `/var/tmp/skincos`.

Backups and durable artifacts remain under `C:\CodexRuntime`. The pre-copy rule
still applies (copy only missing files); the final Windows TAR overlays changed
source files but never deletes a legacy source or destination-only artifact.
`n8n-home` is explicitly excluded from this helper: do not use `rsync`, `cp`,
or a recursive DrvFS copy for Orb state.

Before the window, create the state-only archive under the durable artifacts
root from Windows, record the printed SHA-256, then transfer it with Windows
tar through `\\wsl$` to the Linux filesystem. Do not let WSL read the large
archive through `/mnt/c`: that reverse 9P traversal can hang or silently leave
an incomplete extraction on this host. The archive excludes only the Windows
`node_modules` trees. The staging helper rebuilds the custom nodes with
`npm ci --ignore-scripts` after normalizing a lockfile only when npm proves it
conflicts with the exact package manifest:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\runtime\export-orb-state-archive.ps1 \
  -ArtifactRoot C:\CodexRuntime\artifacts\runtime-cutover\<timestamp>
```

```bash
scripts/runtime/stage-orb-state-archive.sh \
  --extracted-home /home/admin/skincos-orb-transfer/orb-n8n-transfer-<archive-sha>/n8n-home \
  --sha256 <printed-sha256> --apply
```

Run the transfer from Windows after the archive checksum is recorded:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\runtime\transfer-orb-state-archive.ps1 \
  -Archive C:\CodexRuntime\artifacts\runtime-cutover\<timestamp>\n8n-home-state.tar \
  -Sha256 <printed-sha256>
```

Record the resulting `STAGED_ORB_STATE_HOME`. It remains isolated under
`/var/lib/skincos-runtime/staging` until the cutover script atomically promotes
it after the legacy units have stopped. A new archive is required for every
attempted cut; a staging directory is never silently reused.

The pre-copy also transfers the active Livia workflow from the retained legacy
source into `/var/lib/skincos-runtime/orb/workflows`. The lifecycle Orb unit and
the official validator read this runtime location; no workflow state is copied
into the new checkout.

Before the window, use Windows to create a tracked-source archive for the
reviewed SHA and copy it into a native Linux ingress directory. Record its
SHA-256. Do not run `git archive` from WSL against `/mnt/c`: the release helper
accepts only the already-transferred native archive. It creates
`/opt/skincos/current/source`, normalizes executable launchers and installs the
locked CRM production dependencies. All lifecycle units use this path rather
than a DrvFS checkout:

```bash
SKINCOS_RELEASE_ID=<reviewed-main-sha> \
  scripts/runtime/prepare-native-source-release.sh \
    --archive /home/admin/skincos-native-release/<reviewed-main-sha>/source.tar \
    --sha256 <windows-recorded-sha256> \
    --apply
```

Before stopping the legacy WhatsApp service, stage the reviewed release on the
native filesystem. This command is intentionally explicit about the release
SHA and fails if the native lockfile install, Prisma generation or build cannot
produce `dist/main.js`:

```bash
MESSAGING_RELEASE_ID=<reviewed-main-sha> \
  scripts/runtime/prepare-messaging-whatsapp-release.sh --apply
```

The future `messaging-whatsapp.service` starts only
`/opt/skincos/current/messaging-whatsapp/dist/main.js`; it never executes
`npm install`, runs a build, or reads a worktree at service start.

At the window, first stage and verify the non-Git rollback artifacts while
legacy services are still healthy. This is non-disruptive and creates only
runtime artifacts plus symlinks in the retained rollback worktree:

```bash
scripts/runtime/stage-rollback-artifacts.sh \
  --rollback-root /mnt/c/CodexShared/Worktrees/skincos/admin/runtime-cutover-rollback \
  --artifact-root /mnt/c/CodexRuntime/artifacts/runtime-cutover/<timestamp>
```

Use a new timestamped artifact directory for every attempted cut. The staging
helper refuses to overwrite a prior rollback bundle or an existing worktree
link that points elsewhere. If a prior recovery left an older symbolic link in
the worktree, verify the new timestamped bundle and add
`--replace-rollback-links`; this can replace symbolic links only, never a
regular file or directory.

On this Windows host, rollback artifact staging uses native `robocopy` for CRM
dependencies under `C:\`; use `ROLLBACK_ARTIFACT_SYNC_TRANSPORT=rsync` only for
a non-Windows runtime or an explicit diagnostic.

Then use the real backup directory, retained worktree and the exact staged
artifact directory:

```bash
scripts/runtime/cutover-lifecycle-runtime.sh \
  --backup-dir /mnt/c/CodexRuntime/backups/orb/manual/<timestamp> \
  --rollback-root /mnt/c/CodexShared/Worktrees/skincos/admin/runtime-cutover-rollback \
  --rollback-artifact-root /mnt/c/CodexRuntime/artifacts/runtime-cutover/<timestamp> \
  --orb-state-home /var/lib/skincos-runtime/staging/orb-n8n-home-<archive-sha>/n8n-home \
  --windows-transfer-script C:\CodexShared\Projetos\skincos\scripts\runtime\transfer-lifecycle-state.ps1 \
  --windows-orb-export-script C:\CodexShared\Projetos\skincos\scripts\runtime\export-orb-state-archive.ps1 \
  --windows-orb-transfer-script C:\CodexShared\Projetos\skincos\scripts\runtime\transfer-orb-state-archive.ps1

scripts/runtime/cutover-lifecycle-runtime.sh --apply \
  --backup-dir /mnt/c/CodexRuntime/backups/orb/manual/<timestamp> \
  --rollback-root /mnt/c/CodexShared/Worktrees/skincos/admin/runtime-cutover-rollback \
  --rollback-artifact-root /mnt/c/CodexRuntime/artifacts/runtime-cutover/<timestamp> \
  --orb-state-home /var/lib/skincos-runtime/staging/orb-n8n-home-<archive-sha>/n8n-home \
  --windows-transfer-script C:\CodexShared\Projetos\skincos\scripts\runtime\transfer-lifecycle-state.ps1 \
  --windows-orb-export-script C:\CodexShared\Projetos\skincos\scripts\runtime\export-orb-state-archive.ps1 \
  --windows-orb-transfer-script C:\CodexShared\Projetos\skincos\scripts\runtime\transfer-orb-state-archive.ps1
```

The apply command captures all old unit files, stops only the seven legacy
units, has Windows create and transfer the final non-Orb delta, creates a new
authoritative Orb archive only after the legacy n8n service is stopped, then
atomically promotes that checksum-verified native state and starts `orb`,
`orb-proxy`, `messaging-whatsapp`, `crm`, `booking`, `cloudflare-orb` and
`cloudflare-runtime`. It requires local Orb health plus public Orb and CRM
health. Legacy stop/start operations are asynchronous but bounded; a timeout
causes rollback instead of leaving the operator waiting indefinitely. A failed
post-stop step restores the captured units with paths rewritten to the retained
rollback worktree and restarts the legacy services. The dry-run refuses to
continue unless its runtime artifact links resolve to the staged bundle.

## After the cut

- Confirm each lifecycle unit is active and the old unit names are disabled.
- Trigger `orb-backup.service` once. It validates a PostgreSQL restore before
  retaining only the latest lifecycle backup.
- Run the official Orb validator and the local/public CRM and Orb smoke checks.
- Keep the checkpoint at
  `C:\CodexRuntime\backups\runtime-cutover\<timestamp>` and the rollback
  worktree until all checks pass. Only then may the old runtime paths, old
  timer, older backups and the rollback worktree enter retirement review.

## Secret handling

The copy helper reads no secret values to stdout. It relocates private
environment files and tunnel credentials into `/etc/skincos`, rewrites only the
local tunnel config path, and restricts access to `root:skincos` with no
world-readable permission. No credential is written to the repository or to a
worktree.
