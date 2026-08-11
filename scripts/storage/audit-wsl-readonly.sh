#!/usr/bin/env bash
set -euo pipefail

: "${WSL_BOUNDARY_EXCEPTION:?WSL_BOUNDARY_EXCEPTION is required for this read-only infrastructure probe}"

printf 'wsl_boundary_exception=%s\n' "$WSL_BOUNDARY_EXCEPTION"
printf 'generated_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s\n' '--- df ---'
df -P -h / 2>&1 || true

printf '%s\n' '--- top-level entries ---'
find / -mindepth 1 -maxdepth 1 -xdev -printf '%y %s %p\n' 2>&1 || true

printf '%s\n' '--- selected directory entries ---'
for root in /home /var /opt /tmp /root /usr/local /mnt; do
  if [[ -d "$root" ]]; then
    printf 'root=%s\n' "$root"
    find "$root" -mindepth 1 -maxdepth 1 -xdev -printf '%y %s %p\n' 2>&1 || true
  fi
done

printf '%s\n' '--- du probe ---'
if command -v du >/dev/null 2>&1; then
  du -x -h -d 1 / 2>&1 || true
else
  printf '%s\n' 'du=missing'
fi

printf '%s\n' '--- health ---'
if [[ -r /proc/mounts ]]; then grep -E ' / |/mnt/c ' /proc/mounts || true; fi
if [[ -r /proc/sys/fs/file-nr ]]; then cat /proc/sys/fs/file-nr || true; fi
