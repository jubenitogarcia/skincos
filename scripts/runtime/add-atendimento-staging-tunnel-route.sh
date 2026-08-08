#!/usr/bin/env bash
set -euo pipefail

# Retired deliberately: this legacy helper rewrote the shared Cloudflare
# configuration, accepted caller-controlled runtime paths, and reloaded a
# tunnel serving other modules.  The isolated runtime must use a future
# dedicated staging tunnel with fixed credentials and a separately reviewed
# unit, mirroring the production installer.  Do not reintroduce an override or
# a shared-service restart here.
case "${1:-}" in
  ''|--dry-run)
    [[ $# -le 1 ]] || { echo "Usage: $0 [--dry-run|--apply]" >&2; exit 64; }
    printf 'retired=true dedicated_staging_tunnel_required=true shared_restart=false dry_run=true\n'
    ;;
  --apply)
    [[ $# -eq 1 ]] || { echo "Usage: $0 [--dry-run|--apply]" >&2; exit 64; }
    echo 'Refusing to alter the shared Cloudflare runtime; provision a dedicated staging tunnel instead.' >&2
    exit 78
    ;;
  -h|--help)
    echo "Usage: $0 [--dry-run|--apply]"
    echo 'This legacy shared-tunnel mutator is retired and never applies changes.'
    ;;
  *)
    echo "Usage: $0 [--dry-run|--apply]" >&2
    exit 64
    ;;
esac
