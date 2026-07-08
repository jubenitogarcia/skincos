# Security Exceptions

Last review: 2026-04-14

## Policy

- Toda exceção precisa de motivo, escopo e revisão periódica.
- Exceções JS/TS ligadas a `dangerouslySetInnerHTML` e `new Function` são controladas em `.github/security/js-security-exceptions.json`.
- Novas ocorrências fora dessa allowlist falham em `scripts/check-js-security-exceptions.mjs`.

## Closed Exceptions

### CVE-2026-0994 (protobuf)

- **Impact**: DoS via deep recursion in `google.protobuf.json_format.ParseDict()` with nested `Any` messages.
- **Status**: Resolved on 2026-03-10.
- **Fix applied**: upgraded pins to `protobuf==6.33.5`.
- **Updated files**:
  - `backend/requirements.txt`
  - `backend/apps/agent-zero/requirements.txt`
  - `backend/apps/agent-zero/requirements.unified.txt`
  - `backend/apps/agent-zero/pyproject.toml`
- **Validation**: `python -m pip_audit -r backend/requirements.txt` no longer reports `CVE-2026-0994`.

## Active Exceptions

### JS/TS runtime HTML and dynamic execution hotspots

- **Status**: Active with explicit allowlist.
- **Scope**:
  - `modules/site-public/website/src/components/Analytics.tsx`
  - `modules/site-public/website/src/components/MarketingPixels.tsx`
  - `modules/site-public/website/src/app/layout.tsx`
  - `modules/site-public/website/src/app/[unit]/page.tsx`
  - `frontend/EmailTemplatesManager.tsx`
  - `frontend/RichTaskManager.tsx`
  - `frontend/chart.tsx`
- **Reason**:
  - JSON-LD serialization and third-party snippets still require controlled HTML/script injection.
  - Admin HTML previews and markdown rendering remain legacy hotspots pending sanitization hardening.
- **Enforcement**:
  - `node scripts/check-js-security-exceptions.mjs`
  - `.github/workflows/lint-format-static.yml`

### pip-audit dependency resolution (agent-zero)

- **Status**: Temporarily active with expiry control.
- **Scope**:
  - `backend/apps/agent-zero/requirements.txt`
  - `backend/apps/agent-zero/requirements.unified.txt`
- **Reason**: dependency resolution/build metadata issue in `openai-whisper` currently causes pip-audit collection failure (`ModuleNotFoundError: pkg_resources` in isolated build step).
- **Policy source of truth**:
  - `.github/security/pip-audit-path-exceptions.csv`
  - `.github/security/pip-audit-vuln-exceptions.csv`
- **Enforcement**: expired exceptions fail CI in `.github/workflows/security-secrets-audit.yml`.

### pip-audit dependency resolution (crawl4ai vendor requirements)

- **Status**: Temporarily active with expiry control.
- **Scope**:
  - `backend/apps/automations/sprinta/v2/vendor/crawl4ai/requirements.txt`
- **Reason**: `pip-audit` resolves this vendor requirements file in an isolated env and attempts to build `lxml` from source; GitHub hosted runners currently do not provide the required `libxml2/libxslt` development packages for that build.
- **Policy source of truth**:
  - `.github/security/pip-audit-path-exceptions.csv`
  - `.github/security/pip-audit-vuln-exceptions.csv`
- **Enforcement**: expired exceptions fail CI in `.github/workflows/security-secrets-audit.yml`.
