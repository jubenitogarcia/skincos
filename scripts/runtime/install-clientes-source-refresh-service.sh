#!/usr/bin/env bash
set -euo pipefail

# Installation was retired with the legacy runner.  Do not re-create a second
# scheduler beside crm-jobs.service; use retire-clientes-source-refresh-service
# to disable a pre-existing timer with its fixed allowlisted unit names.
printf '%s\n' '{"ok":false,"code":"CLIENTES_SOURCE_LEGACY_INSTALL_DISABLED"}' >&2
exit 78
