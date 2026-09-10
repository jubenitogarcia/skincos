# Ponto Pages — Phase 1 source boundary

This package is the smallest standalone source boundary for the Ponto web
surface. It is intentionally a **source-only** preparation: it has no
Cloudflare account, Pages project, custom domain, route, database, secret, or
publisher. Running its CI cannot publish anything.

## What is included

- the Ponto browser surface and the `/ponto-terminal.html` static terminal;
- restricted Pages Functions for `/api/auth/*`, `/api/insumos/health`, and
  `/api/ponto/*` only;
- local UI primitives, Ponto API types, presentation helpers, and a small
  authentication provider;
- a fail-closed `wrangler.toml`, package-level tests, and a source-only CI
  workflow.

The Ponto proxy remains deliberately strict. A future governed release must
provide its service bindings, rollout control, non-secret identifiers, and
secret custody outside Git. Until then, it returns a configuration error rather
than forwarding a request.

## Install, test, and build

From this directory in WSL or another Linux Node 22+ environment:

```sh
npm ci
npm run check
```

`npm run dev` starts a Vite-only browser preview at `127.0.0.1:5173`. It proves
the standalone client boots, but it does not emulate Pages Functions or grant
authentication. Use `npm run deploy:check` only to verify the intentional
no-publisher guard; it exits non-zero by design.

On the shared Windows workspace, invoke Node commands through
`scripts/invoke-skincos-wsl.ps1` from the repository root, with
`-WorkingDirectory workforce/ponto-pages`.

## Environment and safety

The committed `wrangler.toml` is intentionally unconfigured. Do not add a real
project name, account identifier, route, domain, binding, or secret in this
phase. `.dev.vars.example` shows the safe default posture only; it does not
make an authenticated runtime available.

At a later governed phase, the auth and health Functions accept only the exact
canonical API target for `staging` or `production`; they do not fall back to a
production URL. Local auth is limited to an explicit loopback-only bypass.

## Compatibility

No existing URL has changed. The active legacy URLs remain:

- `https://crm.skincos.com.br/?module=ponto`
- `https://crm.skincos.com.br/ponto-terminal.html`
- `/api/ponto/*` and `/api/auth/*` on that legacy Pages origin

See [docs/compatibility-handoff.md](docs/compatibility-handoff.md) for the
future migration and rollback requirements. In particular, terminal device
tokens are origin-local and must be deliberately re-paired after a new host is
live.

Facial identification remains disabled in the copied Ponto source. If it is
later deliberately enabled, run `npm run fetch-face-models` and keep the
downloaded weights out of Git; the command is not part of normal install,
build, test, or publishing.
