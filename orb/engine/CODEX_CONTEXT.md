# Orb engine context

- The repository root `CODEX_CONTEXT.md` is authoritative for workspace and runtime operations.
- Orb source is `orb/engine`; immutable production source resolves through `/opt/skincos/current/source`.
- Mutable state is `/var/lib/skincos-runtime/orb`, private configuration is `/etc/skincos`, logs are `/var/log/skincos/orb`, and verified native backups are created under `/var/backups/skincos/orb/daily`.
- The supported units are `orb.service` and `orb-proxy.service`. Use `npm run service:status`, `service:restart`, `service:logs` and `service:validate` from this directory.
- WhatsApp is owned by `messaging-whatsapp.service`; Cloudflare ingress is owned by `cloudflare-orb.service`.
- The Windows task `SkincosOrbBackup` is the only backup scheduler and publishes a restore-verified native snapshot to `C:\CodexRuntime\backups\orb\daily`.
- No live process may execute from the shared checkout, a worktree or DrvFS. No secret, session, database or browser profile belongs in Git.
- Clinic workflows remain inactive until Google Calendar scope, calendar ID and non-production-safe test data are approved.
