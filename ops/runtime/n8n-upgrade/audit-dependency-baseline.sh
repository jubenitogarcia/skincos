#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
MANIFEST="$ROOT/VERSION_MANIFEST.json"
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf 'INFO: %s\n' "$*"; }

dry_run=0
if [[ "${1:-}" == "--dry-run" ]]; then dry_run=1; shift; fi
[[ $# -eq 1 ]] || die 'uso: audit-dependency-baseline.sh [--dry-run] <versao-n8n>'
version=$1
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die 'versao n8n invalida.'
[[ "${N8N_UPGRADE_ENV:-}" == staging && "${N8N_EXPECTED_ENV:-}" == staging ]] || die 'a auditoria somente pode executar em staging.'
[[ "${N8N_STAGING_MARKER:-}" == orb-n8n-staging ]] || die 'staging marker ausente ou invalido.'
audit_root=${N8N_AUDIT_ROOT:-}
[[ -n "$audit_root" && "$audit_root" = /* ]] || die 'N8N_AUDIT_ROOT deve ser um caminho absoluto Linux privado.'
[[ "$audit_root" != /opt/* && "$audit_root" != /var/lib/* && "$audit_root" != /etc/* ]] || die 'N8N_AUDIT_ROOT nao pode apontar para runtime ou configuracao de producao.'
expected_node=${N8N_AUDIT_NODE_VERSION:-v22.23.1}
expected_npm=${N8N_AUDIT_NPM_VERSION:-10.9.8}
[[ "$(node --version)" == "$expected_node" ]] || die "Node divergente: esperado $expected_node, obtido $(node --version)."
[[ "$(npm --version)" == "$expected_npm" ]] || die "npm divergente: esperado $expected_npm, obtido $(npm --version)."
[[ "$(node -p 'process.platform')" == linux && "$(node -p 'process.arch')" == x64 ]] || die 'plataforma divergente; esperado linux/x64.'

legacy_suffix=
if [[ "${N8N_AUDIT_INCLUDE_LEGACY_EVOLUTION:-0}" == 1 ]]; then legacy_suffix='-live-exact'; fi
workdir="$audit_root/n8n-${version}${legacy_suffix}"
in_progress="${workdir}.in-progress.$$"
if (( dry_run )); then
  info "DRY-RUN dependency audit: n8n=$version root=$workdir node=$expected_node npm=$expected_npm platform=linux/x64 flags=--ignore-scripts,--omit=optional topology=isolated-runtime-and-community"
  exit 0
fi
[[ "${N8N_AUDIT_APPLY:-}" == YES ]] || die 'recusado: defina N8N_AUDIT_APPLY=YES para gravar apenas no staging isolado.'
[[ ! -e "$workdir" && ! -e "$in_progress" ]] || die "diretorio de auditoria ja existe: $workdir (recusa sobrescrever evidencias)."
mkdir -p "$in_progress/components"

node --input-type=module - "$MANIFEST" "$in_progress" "$version" "${N8N_AUDIT_INCLUDE_LEGACY_EVOLUTION:-0}" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const [manifestPath, root, n8nVersion, legacy] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const packages = [{ key: 'runtime-n8n', name: 'n8n', version: n8nVersion }]
  .concat(manifest.additional_packages.map(({ name, version }) => ({ key: `community-${name.replace(/[^a-z0-9]+/gi, '_')}`, name, version })));
if (legacy === '1') packages.push({ key: 'community-n8n_nodes_evolution_api_legacy', name: 'n8n-nodes-evolution-api', version: '1.0.4' });
for (const item of packages) {
  const directory = path.join(root, 'components', item.key);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify({
    name: `skincos-dependency-audit-${item.key}`,
    private: true,
    version: '0.0.0',
    description: 'Synthetic dependency-only audit fixture. Never a runtime installation.',
    engines: { node: '22.23.1', npm: '10.9.8' },
    dependencies: { [item.name]: item.version },
  }, null, 2)}\n`, { mode: 0o600 });
}
fs.writeFileSync(path.join(root, 'components.json'), `${JSON.stringify(packages, null, 2)}\n`, { mode: 0o600 });
NODE

while IFS=$'\t' read -r key name component_version; do
  component="$in_progress/components/$key"
  (
    cd "$component"
    npm install --package-lock-only --ignore-scripts --omit=optional
    if [[ -d "$component/node_modules" ]]; then rm -rf -- "$component/node_modules"; fi
    npm ci --ignore-scripts --omit=optional
    npm audit --omit=optional --json > audit.json || audit_exit=$?
    : "${audit_exit:=0}"
    npm ls --all --json > dependency-tree.json || true
    node --input-type=module - "$key" "$name" "$component_version" "$audit_exit" <<'NODE'
import fs from 'node:fs';
const [component, directPackage, directVersion, auditExit] = process.argv.slice(2);
const audit = JSON.parse(fs.readFileSync('audit.json', 'utf8'));
const chain = (entry) => ['root', ...entry.replace(/^node_modules\//, '').split('/node_modules/')].join(' -> ');
const highCritical = Object.values(audit.vulnerabilities ?? {})
  .filter((item) => item.severity === 'high' || item.severity === 'critical')
  .map((item) => ({
    component, direct_package: directPackage, direct_version: directVersion,
    package: item.name, severity: item.severity, direct: Boolean(item.isDirect),
    chains: [...new Set((item.nodes ?? []).map(chain))], effects: item.effects ?? [], range: item.range,
    fix_available: item.fixAvailable ?? false,
    via: (item.via ?? []).map((via) => typeof via === 'string' ? { package: via } : {
      source: via.source, title: via.title, url: via.url, severity: via.severity,
      range: via.range, cvss: via.cvss?.score ?? null,
    }),
  }));
fs.writeFileSync('summary.json', `${JSON.stringify({ component, direct_package: directPackage, direct_version: directVersion, audit_exit: Number(auditExit), counts: audit.metadata?.vulnerabilities ?? {}, high_critical: highCritical }, null, 2)}\n`, { mode: 0o600 });
NODE
  )
done < <(node --input-type=module - "$in_progress/components.json" <<'NODE'
import fs from 'node:fs';
for (const item of JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))) console.log([item.key, item.name, item.version].join('\t'));
NODE
)

node --input-type=module - "$in_progress" "$legacy_suffix" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const [root, inventory] = process.argv.slice(2);
const components = JSON.parse(fs.readFileSync(path.join(root, 'components.json'), 'utf8'))
  .map(({ key }) => JSON.parse(fs.readFileSync(path.join(root, 'components', key, 'summary.json'), 'utf8')));
const runtime = components.find(({ component }) => component === 'runtime-n8n');
if (!runtime) throw new Error('runtime n8n component missing from dependency audit');
const unique = new Map();
for (const item of components.flatMap((component) => component.high_critical)) {
  const advisory = item.via.map((via) => via.source ?? via.url ?? via.package ?? '').join(',');
  const key = `${item.package}|${advisory}|${item.component}`;
  unique.set(key, item);
}
const report = {
  schema_version: 2,
  fixture: 'synthetic dependency-only; mirrors the production topology: n8n runtime and each managed community package are independently installed. No production configuration, data, credentials, database, or workflow is loaded.',
  n8n_version: runtime.direct_version, inventory: inventory || 'target-10', node: process.version,
  npm: process.env.npm_config_user_agent ?? 'npm/unknown', platform: `${process.platform}/${process.arch}`,
  install_flags: ['--ignore-scripts', '--omit=optional'], components: components.map(({ component, direct_package, direct_version, counts }) => ({ component, direct_package, direct_version, counts })),
  high_critical: [...unique.values()].sort((a, b) => a.severity.localeCompare(b.severity) || a.package.localeCompare(b.package)),
};
fs.writeFileSync(path.join(root, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ n8n_version: report.n8n_version, inventory: report.inventory, components: report.components.length, high_critical: report.high_critical.length }));
NODE

mv "$in_progress" "$workdir"
info "dependency audit completed: $workdir/summary.json"
