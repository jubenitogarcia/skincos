#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
LAUNCHER="$ROOT_DIR/scripts/runtime/run-messaging-whatsapp-release.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/release/node_modules" "$tmp_dir/release/dist" "$tmp_dir/bin"
printf 'process.exit(0);\n' >"$tmp_dir/release/dist/main.js"
printf 'PRIVATE_TEST_VALUE=loaded\n' >"$tmp_dir/runtime.env"

/usr/bin/node - "$tmp_dir/release" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const canonicalJson = (value) => Array.isArray(value)
  ? '[' + value.map(canonicalJson).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
    : JSON.stringify(value);
const digestFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceCommit = 'a'.repeat(40);
const identity = {
  schemaVersion: 2,
  module: 'messaging-whatsapp',
  sourceCommit,
  sourceTree: 'b'.repeat(40),
  sourceArchiveSha256: 'c'.repeat(64),
  releaseManifestSha256: 'd'.repeat(64),
  dependencyClosureDigest: 'e'.repeat(64),
  artifacts: [
    { name: 'release-source-archive', id: 'release-source:' + sourceCommit, digest: 'c'.repeat(64) },
    { name: 'whatsapp-dist-main', id: 'whatsapp-dist:' + sourceCommit, digest: digestFile(path.join(root, 'dist', 'main.js')) },
  ],
  predecessor: {
    sourceCommit: 'f'.repeat(40),
    sourceTree: '0'.repeat(40),
    identityDigest: '1'.repeat(64),
    artifactDigest: '2'.repeat(64),
  },
};
identity.identityDigest = crypto.createHash('sha256').update(canonicalJson(identity)).digest('hex');
fs.writeFileSync(path.join(root, '.skincos-release-identity-messaging-whatsapp.json'), JSON.stringify(identity, null, 2) + '\n');
NODE

printf '%s\n' '#!/usr/bin/env bash' \
  'if [[ "$1" == "-" ]]; then exec /usr/bin/node "$@"; fi' \
  'test "$PRIVATE_TEST_VALUE" = loaded' \
  'test "$1" = dist/main.js' >"$tmp_dir/bin/node"
chmod +x "$tmp_dir/bin/node"

MESSAGING_RELEASE_ROOT="$tmp_dir/release" EVOLUTION_API_ENV_FILE="$tmp_dir/runtime.env" NODE_BIN="$tmp_dir/bin/node" \
  "$LAUNCHER"

printf 'tampered\n' >"$tmp_dir/release/dist/main.js"
if MESSAGING_RELEASE_ROOT="$tmp_dir/release" EVOLUTION_API_ENV_FILE="$tmp_dir/runtime.env" NODE_BIN="$tmp_dir/bin/node" "$LAUNCHER"; then
  echo 'Launcher must fail closed when the built artifact differs from its immutable identity.' >&2
  exit 1
fi

echo 'Messaging WhatsApp native release launcher checks passed'
