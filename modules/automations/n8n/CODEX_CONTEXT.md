# CODEX_CONTEXT

## Current State

- Shared n8n workspace embedded at
  `C:\CodexShared\Projetos\skincos\modules\automations\n8n`.
- Live runtime target is now the shared code root plus machine runtime model:
  `C:\CodexShared\Projetos\skincos\modules\automations\n8n` for code and
  `C:\CodexRuntime\n8n` for state.
- Validation from a second Windows user (`dev`) confirmed the shared clone can be
  read directly from `C:\CodexShared` without opening
  `C:\Users\julia\Automation\n8n`.
- Git on a second Windows user requires per-user `safe.directory` registration
  before normal commands like `git status` work in the shared clone or worktrees.
- The shared clone `origin` now points to
  `https://github.com/jubenitogarcia/skincos.git`, not to a legacy local path
  or to a retired standalone `n8n.git` workflow.
- GitHub authentication and remote read/write dry-run validation succeeded from
  the second Windows user account.
- Shared operational scripts and systemd templates were updated to resolve the
  shared clone path instead of the legacy Windows checkout path.
- Phase-2 WSL cutover tooling now targets the shared clone plus the machine
  runtime under `C:\CodexRuntime\n8n`, including env files, Evolution state,
  n8n home, Cloudflare tunnel files, logs, tmp and binary-data.
- Live runtime health is currently validated from the shared model:
  `skincos-n8n.service`, `skincos-orb-proxy.service`,
  `skincos-cloudflared-orb.service`, `skincos-evolution.service`, and
  `skincos-mini-pc-watchdog.timer` are active; local and public health
  endpoints respond; and the shared live contract is validated from env,
  installed units, permissions, and HTTP health checks.
- The live `n8n` metadata store now runs on PostgreSQL via the `DB_POSTGRESDB_*`
  contract in `C:\CodexRuntime\n8n\env\n8n.env`; the SQLite helper files under
  `n8n-home` are no longer the canonical live source of truth for workflows.
- A dedicated business-readiness validator now exists at
  `scripts/validate-mini-pc-business-readiness.sh` so runtime health and clinic
  readiness can be checked separately.
- `GOOGLE_CALENDAR_ID` is currently treated as an optional live binding in that
  validator, because the shared orb runtime can stay healthy without activating
  the Google Calendar-backed scheduling path yet.
- A reusable WSL base export was generated at
  `C:\CodexShared\Projetos\_bootstrap\wsl\ubuntu-24.04-codex-base.tar` and
  validated by importing a clean test distro that bootstrapped successfully
  against the shared code/runtime model.
- Fresh imported accounts should validate with
  `bash scripts/preflight-wsl-shared-runtime.sh --shared-only --strict-live`
  because the shared-account model intentionally does not require legacy
  `~/Automation`, `~/.n8n`, or `~/.cloudflared` paths.
- The shared clone is currently on branch `codex/julia/shared-bootstrap` at
  `e6c66ac9`; `origin/main` is `b43a6c62`, so the shared baseline is not yet a
  clean `main` checkout.

## Operational Model

- Use this clone for shared workflow code, exported snapshots, docs, task
  handoff, and non-secret collaboration across Codex accounts.
- Treat `C:\CodexRuntime\n8n` as the live machine runtime state shared by the
  operator's Windows accounts.
- If a task changes live workflows, document whether the browser, database,
  runtime, and shared clone are all in sync.

## Known Constraints

- WSL distributions are installed per Windows user, so a new local account may
  still need its own `Ubuntu-24.04` bootstrap before it can operate the live
  runtime directly.
- The exported distro tar currently lives under `C:\CodexShared\Projetos`
  rather than `C:\CodexShared\Backups` because the current ACL on `Backups` is
  read-only for `Users`.
- The shared repo still carries local multi-account migration changes that have
  not yet been reconciled back to `main`.

## Next Recommended Steps

- Create per-task worktrees under `C:\CodexShared\Worktrees\skincos\...` when
  a task needs isolated Git work on the umbrella repo.
- Keep `C:\CodexRuntime\n8n` as the single machine runtime root for env,
  database, Cloudflare tunnel files, Evolution instances/store and runtime
  logs.
- For each new Windows account, import the shared WSL base tar, run
  `bootstrap-imported-wsl-account.sh`, authenticate `gh`, and validate with the
  shared-only preflight.
- Reconcile `codex/julia/shared-bootstrap` against `origin/main` before final
  destructive cleanup of legacy paths.
- Legacy Windows and WSL runtime paths were removed after shared-runtime
  validation. Keep treating
  `C:\CodexShared\Projetos\skincos\modules\automations\n8n` and
  `C:\CodexRuntime\n8n` as the only supported baseline.
- Legacy user-service installers, user-service validators, and SQLite-only
  workflow editing helpers should be treated as historical utilities, not as
  the primary operating path for the orb runtime.
