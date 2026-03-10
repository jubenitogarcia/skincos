# Security Exceptions

Last review: 2026-03-10

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
