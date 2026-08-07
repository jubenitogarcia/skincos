#!/usr/bin/env bash
set -euo pipefail

# Compatibility stub only.  The previous runtime accepted environment-derived
# paths and sourced private files before calling the legacy importer.  That
# contract is retired: v2 is the sole source operation path and this entrypoint
# must never load an environment, spawn a command, create a backup, or mutate.
printf '%s\n' '{"ok":false,"code":"CLIENTES_SOURCE_LEGACY_REFRESH_DISABLED"}' >&2
exit 78
