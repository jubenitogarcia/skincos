#!/usr/bin/env bash
set -euo pipefail

legacy_patterns=(
  "/home/julia"
  "/srv/skincos"
  "/etc/skincos"
  "systemctl --user"
)

mapfile -t unit_files < <(sudo -n find /etc/systemd/system -maxdepth 1 \( -name 'skincos-*.service' -o -name 'skincos-*.timer' \) -type f | sort)

if [[ "${#unit_files[@]}" -eq 0 ]]; then
  echo "No skincos system units found."
  exit 0
fi

echo "== installed skincos system units =="
printf '%s\n' "${unit_files[@]}"

echo "== active state =="
for unit_path in "${unit_files[@]}"; do
  unit_name="$(basename "$unit_path")"
  if sudo -n systemctl --quiet is-active "$unit_name"; then
    state="active"
  else
    state="inactive"
  fi
  printf '%s %s\n' "$unit_name" "$state"
done

echo "== legacy path references =="
found=0
for pattern in "${legacy_patterns[@]}"; do
  if sudo -n grep -n -F "$pattern" "${unit_files[@]}" >/dev/null 2>&1; then
    echo "pattern: $pattern"
    sudo -n grep -n -F "$pattern" "${unit_files[@]}"
    found=1
  fi
done

if [[ "$found" == "0" ]]; then
  echo "No legacy path references found in installed skincos system units."
fi
