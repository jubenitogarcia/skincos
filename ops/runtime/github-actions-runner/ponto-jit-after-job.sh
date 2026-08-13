#!/usr/bin/env bash
set -euo pipefail

# The cleanup helper has no caller-controlled path or argument and is the only
# privileged transition granted to the clinic runner account.
exec sudo -n /usr/local/sbin/skincos-provision-ponto-jit cleanup
