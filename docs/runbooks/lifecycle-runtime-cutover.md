# Native runtime release, recovery and rollback

## Contract

- Reviewed source: immutable `/opt/skincos/releases/<sha>/source` with the
  atomic link `/opt/skincos/current/source`.
- WhatsApp build: `/opt/skincos/releases/<sha>/messaging-whatsapp` with the
  atomic link `/opt/skincos/current/messaging-whatsapp`.
- State: `/var/lib/skincos-runtime`; secrets/config: `/etc/skincos`; logs:
  `/var/log/skincos`; cache/tmp: native Linux filesystems only.
- Units: `orb`, `orb-proxy`, `messaging-whatsapp`, `crm`, `booking`,
  `cloudflare-orb` and `cloudflare-runtime`.
- Native backup staging: `/var/backups/skincos/orb/daily`.
- Durable published backup and operator evidence: `C:\CodexRuntime`.

No active process may read mutable state or execute code from DrvFS, a shared
checkout or a worktree. Windows initiates every Windows-to-Linux transfer
through `\\wsl.localhost`; WSL never recursively walks `/mnt/c`.

## Release promotion

1. Confirm the reviewed `origin/main` SHA and a clean canonical clone.
2. On Windows, create `git archive --format=tar <sha>` in the private runtime,
   compute SHA-256, produce verified lineage against `origin/main`, and copy
   the tar and lineage to native Linux storage through
   `\\wsl.localhost\Ubuntu-24.04\home\admin\skincos-native-release\<sha>`.

   ```powershell
   & scripts/runtime/verify-native-source-release-lineage.ps1 -ReleaseSha <sha> -ParentReleaseSha <current-release-sha>
   ```
3. From the reviewed Git tree in WSL, materialize one closure attestation for
   each native module that will mutate. The output is private operator evidence
   and is bound to the exact source SHA/tree; it is not a substitute for the
   lease acquired during promotion:

   ```bash
   node scripts/codex-global-coordination-workflow.mjs closure \
     --module orb --source <sha> \
     --result-file /home/admin/skincos-native-release/<sha>/orb-closure.json
   node scripts/codex-global-coordination-workflow.mjs closure \
      --module atendimento --source <sha> \
      --result-file /home/admin/skincos-native-release/<sha>/atendimento-closure.json
   node scripts/codex-global-coordination-workflow.mjs closure \
      --module native-runtime --source <sha> \
      --result-file /home/admin/skincos-native-release/<sha>/native-runtime-closure.json
   ```

4. From WSL, validate and stage source. Every applied native release must carry
   the closures used by its mutators:

   ```bash
   scripts/runtime/prepare-native-source-release.sh \
      --archive /home/admin/skincos-native-release/<sha>/source.tar \
      --sha256 <sha256> --lineage /home/admin/skincos-native-release/<sha>/lineage.json \
      --lineage-sha256 <lineage-sha256> \
      --coordination-closure /home/admin/skincos-native-release/<sha>/orb-closure.json \
      --coordination-closure /home/admin/skincos-native-release/<sha>/atendimento-closure.json \
      --coordination-closure /home/admin/skincos-native-release/<sha>/native-runtime-closure.json \
      --apply --stage-only
   ```

5. Build and promote WhatsApp from the same source release, reusing the exact
   Orb closure and lease family:

   ```bash
   scripts/runtime/prepare-messaging-whatsapp-release.sh \
      --source-root /opt/skincos/releases/<sha>/source \
      --release-sha <sha> \
      --coordination-closure /home/admin/skincos-native-release/<sha>/orb-closure.json \
      --apply
   ```

6. Render/install only final units and restart them:

   ```bash
   scripts/runtime/prepare-lifecycle-layout.sh \
      --source-sha <sha> \
      --coordination-closure /home/admin/skincos-native-release/<sha>/native-runtime-closure.json \
      --apply
   scripts/runtime/install-lifecycle-units.sh --apply
   scripts/runtime/manage-native-runtime.sh restart
   scripts/runtime/manage-native-runtime.sh validate
   ```

6. Verify every process working directory and executable resolves under
   `/opt/skincos/releases/<sha>` or a system binary. Verify no process maps a
   worktree or `/mnt/c` path.

## Backup and restore proof

The Windows task `SkincosOrbBackup` is the only scheduler. It starts
`orb-backup.service`, waits for the native restore check, copies the result to
`C:\CodexRuntime\backups\orb\daily`, validates the database and storage hashes
again, applies private ACLs and retains only restore-verified snapshots.

Manual proof:

```powershell
Start-ScheduledTask -TaskName SkincosOrbBackup
while ((Get-ScheduledTask -TaskName SkincosOrbBackup).State -eq 'Running') {
  Start-Sleep -Seconds 2
}
Get-ScheduledTaskInfo -TaskName SkincosOrbBackup
Get-ChildItem C:\CodexRuntime\backups\orb\daily
```

Acceptance requires `LastTaskResult = 0`, `RestoreVerified=True`, matching
database/storage hashes, a readable tar and ACLs limited to SYSTEM and `admin`.
Do not install a WSL timer or launch Windows executables from a systemd unit.

## Controlled restart and smoke

```bash
scripts/runtime/manage-native-runtime.sh status
scripts/runtime/manage-native-runtime.sh validate
systemctl show -p NRestarts,ActiveState,SubState \
  orb orb-proxy messaging-whatsapp crm booking cloudflare-orb cloudflare-runtime
```

Validate at minimum:

- Orb `http://127.0.0.1:5678/healthz` and `https://orb.skincos.com.br/healthz`;
- CRM `http://127.0.0.1:8099/health` and `https://crm.skincos.com.br`;
- Booking `http://127.0.0.1:8765/healthz`;
- API and website public endpoints;
- WhatsApp `https://wa.skincos.com.br/health` plus authenticated credential and
  instance checks without printing tokens or session data;
- workflows, execution count and the invariant that Livia does not restart Orb.

Repeat after `wsl --shutdown` and keepalive recovery to prove restart
persistence before retiring a prior release.

## Rollback

Before promotion, record current links, units, environment file metadata,
ports, health responses and the latest restore-verified backup. Preserve the
previous immutable release and cutover checkpoint until the new release passes
restart and observation checks.

If a critical smoke fails:

1. stop only the affected final units;
2. atomically repoint `/opt/skincos/current/source` and, when relevant,
   `/opt/skincos/current/messaging-whatsapp` to the previous release;
3. restore captured unit/config files only if they changed;
4. restore state only from the verified backup when state corruption is proven;
5. daemon-reload, restart affected units and repeat local/public smokes;
6. keep the failed release and logs as private evidence until diagnosis closes.

Never roll back by starting source from a worktree or by reviving retired units.

## Retention and cleanup

After successful restart persistence, public smoke and observation:

- keep the active release and one proven prior release, **plus every release
  referenced by a workflow runtime manifest**. Before deleting any release,
  run `scripts/runtime/assert-workflow-runtime-retention.sh --candidate-delete
  <release-sha>` and stop on a protected-reference failure;
- keep the latest restore-verified Orb backup plus the explicit cutover
  checkpoint while it still has audit value;
- remove stale staging archives, caches, disabled unit files and clean merged
  worktrees with no open PR or active reference;
- never remove dirty/unmerged worktrees, secrets, sessions, VHDs or evidence
  without a separate proof and checkpoint.
