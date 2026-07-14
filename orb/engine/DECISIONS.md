# DECISIONS

## 2026-07-02 - Shared clone first, live runtime later

- Decision: create a clean shared n8n workspace in
  `C:\CodexShared\Projetos\skincos\modules\automations\n8n` but do
  not move the active WSL runtime in the first phase.
- Why: the live service depends on WSL-only paths, `.env` files, `.n8n`
  database state, and current user services.
- Impact: collaboration becomes shared immediately, while runtime migration is a
  separate guarded cutover.

## 2026-07-02 - Keep secrets and runtime state private

- Decision: do not place `.env`, `.n8n`, database copies, or tunnel credentials
  inside the shared clone or worktrees.
- Why: multiple Windows users can access the shared area.
- Impact: live execution continues from private operator paths until an explicit
  runtime design replaces them.

## 2026-07-02 - Shared clone is the handoff base

- Decision: use this clone for documentation, snapshots, task continuity, and
  clean branch starts across Codex accounts.
- Why: it reduces dependence on a single user's profile and current thread
  history.
- Impact: every handoff must update `CODEX_CONTEXT.md` and `TASKS.md`.

## 2026-07-02 - Shared clones need per-user Git trust bootstrap

- Decision: every local Windows user must register shared clones and worktrees
  under `git config --global safe.directory` before using them normally.
- Why: Git blocks commands with `detected dubious ownership` when the clone is
  owned by a different Windows SID.
- Impact: cross-account onboarding must include a short Git bootstrap step.

## 2026-07-02 - Shared clone origin must point to GitHub, not a local checkout

- Decision: the shared `n8n` clone `origin` must use
  `https://github.com/jubenitogarcia/n8n.git`.
- Why: a shared clone cannot depend on `C:\Users\julia\Automation\n8n` being
  present on another Windows user.
- Impact: remote validation and future push/pull work become account-scoped
  GitHub operations instead of local-path coupling.

## 2026-07-03 - Shared WSL runtime uses machine-shared state

- Decision: the WSL live runtime must use the shared clone for code and the
  machine-shared runtime `C:\CodexRuntime\n8n` for `.env`, Evolution
  instances/store, `n8n-home`, `cloudflared`, logs, tmp and binary data.
- Why: the operator wants equivalent capability across local Windows accounts
  without placing mutable runtime state inside the shared repo.
- Impact: the phase-2 cutover installs systemd units that point at the shared
  clone root and at `/mnt/c/CodexRuntime/n8n` for all live state.

## 2026-07-03 - New Windows accounts import a sanitized WSL base

- Decision: onboard new Windows accounts by importing a reusable WSL tar and
  then running a shared-only bootstrap against `C:\CodexShared` and
  `C:\CodexRuntime\n8n`.
- Why: WSL distros are per Windows user, but the code/runtime hierarchy is now
  machine-shared and should be reproducible with minimal manual setup.
- Impact: per-account onboarding is reduced to `wsl --import`, `gh auth login`,
  and the shared-only preflight instead of rebuilding the live stack from
  scratch.

## 2026-07-03 - Legacy n8n runtime paths are no longer part of rollback

- Decision: remove the old Windows checkout `C:\Users\julia\Automation\n8n`
  and the old WSL runtime paths `/home/julia/Automation`, `/home/julia/.n8n`,
  and `~/.cloudflared` after live shared-runtime validation passed.
- Why: the shared code root and machine runtime are now the supported baseline,
  and keeping the legacy trees around only increases ambiguity between old and
  current execution paths.
- Impact: future operators must treat
  `C:\CodexShared\Projetos\skincos\modules\automations\n8n` plus
  `C:\CodexRuntime\n8n` as the only live source of truth on this machine.

## 2026-07-08 - Keep legacy user-service and SQLite tooling explicit and out of the main runtime path

- Decision: preserve legacy helpers such as `start-n8n.sh`,
  `install-mini-pc-systemd.sh`, `validate-mini-pc-stack.sh`,
  `cutover-wsl-shared-runtime.sh`, and the SQLite-oriented workflow assistant
  only as historical or rollback tools, not as default operating commands.
- Why: after the shared-runtime migration, those helpers can confuse operators
  and accidentally reintroduce `systemctl --user`, checkout-local PID/log
  files, or SQLite-first assumptions into a PostgreSQL-backed live runtime.
- Impact: package scripts and docs must steer day-to-day orb operations toward
  `service:*`, `skincos-*` system units, `C:\CodexRuntime\n8n`, and browser-led
  live workflow management, while any legacy path must be called explicitly.
