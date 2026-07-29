#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
INVENTORY="$ROOT/community-packages.json"
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf 'INFO: %s\n' "$*"; }

[[ $# -eq 1 ]] || die 'usage: audit-release-baseline.sh <n8n-version>'
version=$1
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die 'invalid n8n version.'
[[ "${N8N_UPGRADE_ENV:-}" == staging && "${N8N_EXPECTED_ENV:-}" == staging ]] || die 'audit is staging-only.'
[[ "${N8N_STAGING_MARKER:-}" == orb-n8n-staging ]] || die 'staging marker is absent or invalid.'
[[ "${N8N_AUDIT_APPLY:-}" == YES ]] || die 'refused: set N8N_AUDIT_APPLY=YES for an isolated fixture.'
audit_root=${N8N_AUDIT_ROOT:-}
[[ -n "$audit_root" && "$audit_root" = /* ]] || die 'N8N_AUDIT_ROOT must be an absolute private Linux path.'
[[ "$audit_root" != /opt/* && "$audit_root" != /var/lib/* && "$audit_root" != /etc/* ]] || die 'audit root must not be a runtime or production configuration path.'
[[ "$(node -p process.platform)" == linux && "$(node -p process.arch)" == x64 ]] || die 'expected linux/x64.'
expected_node=${N8N_AUDIT_NODE_VERSION:-v22.23.1}
expected_npm=${N8N_AUDIT_NPM_VERSION:-10.9.8}
[[ "$(node --version)" == "$expected_node" ]] || die "Node mismatch: expected $expected_node."
[[ "$(npm --version)" == "$expected_npm" ]] || die "npm mismatch: expected $expected_npm."
[[ -f "$INVENTORY" ]] || die 'community inventory is missing.'

workdir="$audit_root/n8n-$version"
in_progress="$workdir.in-progress.$$"
[[ ! -e "$workdir" && ! -e "$in_progress" ]] || die 'refusing to overwrite evidence.'
mkdir -p "$in_progress/components"

node --input-type=module - "$INVENTORY" "$in_progress" "$version" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const [inventoryPath, root, n8nVersion] = process.argv.slice(2);
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const packages = [{ key: 'runtime-n8n', name: 'n8n', version: n8nVersion }, ...inventory.packages]
  .map((item) => ({ ...item, key: item.key ?? `community-${item.name.replace(/[^a-z0-9]+/gi, '_')}` }));
for (const item of packages) {
  const component = path.join(root, 'components', item.key);
  fs.mkdirSync(component, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(component, 'package.json'), `${JSON.stringify({ private: true, name: `skincos-release-audit-${item.key}`, version: '0.0.0', dependencies: { [item.name]: item.version } }, null, 2)}\n`, { mode: 0o600 });
}
fs.writeFileSync(path.join(root, 'components.json'), `${JSON.stringify(packages, null, 2)}\n`, { mode: 0o600 });
NODE

while IFS=$'\t' read -r key name component_version; do
  component="$in_progress/components/$key"
  (
    cd "$component"
    npm install --package-lock-only --ignore-scripts --omit=optional
    ci_log=$(mktemp)
    if ! npm ci --ignore-scripts --omit=optional >"$ci_log" 2>&1; then
      if ! grep -q 'ENOTEMPTY' "$ci_log"; then cat "$ci_log" >&2; rm -f "$ci_log"; exit 1; fi
      rm -rf -- "$component/node_modules"
      npm ci --ignore-scripts --omit=optional
    fi
    rm -f "$ci_log"
    npm audit --omit=optional --json > audit.json || audit_exit=$?
    : "${audit_exit:=0}"
    node --input-type=module - "$key" "$name" "$component_version" "$audit_exit" <<'NODE'
import fs from 'node:fs';
const [component, directPackage, directVersion, auditExit] = process.argv.slice(2);
const audit = JSON.parse(fs.readFileSync('audit.json', 'utf8'));
const highCritical = Object.values(audit.vulnerabilities ?? {}).filter((item) => ['high', 'critical'].includes(item.severity)).map((item) => ({
  component, direct_package: directPackage, direct_version: directVersion, package: item.name, severity: item.severity,
  direct: Boolean(item.isDirect), range: item.range, effects: item.effects ?? [], fix_available: item.fixAvailable ?? false,
  via: (item.via ?? []).map((via) => typeof via === 'string' ? { package: via } : ({ source: via.source, title: via.title, url: via.url, severity: via.severity, range: via.range }))
}));
fs.writeFileSync('summary.json', `${JSON.stringify({ component, direct_package: directPackage, direct_version: directVersion, audit_exit: Number(auditExit), counts: audit.metadata?.vulnerabilities ?? {}, high_critical: highCritical }, null, 2)}\n`, { mode: 0o600 });
NODE
  )
done < <(node --input-type=module - "$in_progress/components.json" <<'NODE'
import fs from 'node:fs';
for (const item of JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))) console.log([item.key, item.name, item.version].join('\t'));
NODE
)

node --input-type=module - "$in_progress" <<'NODE'
import fs from 'node:fs'; import path from 'node:path';
const root = process.argv[2];
const components = JSON.parse(fs.readFileSync(path.join(root, 'components.json'), 'utf8')).map(({ key }) => JSON.parse(fs.readFileSync(path.join(root, 'components', key, 'summary.json'), 'utf8')));
const high_critical = components.flatMap((component) => component.high_critical);
const report = { schema_version: 1, fixture_scope: 'Synthetic dependency-only audit. It never reads runtime configuration, data, credentials, database, workflows, or production paths.', node: process.version, npm: process.env.npm_config_user_agent ?? 'npm/unknown', platform: `${process.platform}/${process.arch}`, install_flags: ['--ignore-scripts', '--omit=optional'], n8n_version: components.find((item) => item.component === 'runtime-n8n').direct_version, components: components.map(({ component, direct_package, direct_version, counts }) => ({ component, direct_package, direct_version, counts })), high_critical };
fs.writeFileSync(path.join(root, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
NODE
mv "$in_progress" "$workdir"
info "dependency audit completed: $workdir/summary.json"
