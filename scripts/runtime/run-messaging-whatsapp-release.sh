#!/usr/bin/env bash
set -euo pipefail

# Production launcher: it never installs packages, runs Prisma generation, or
# builds TypeScript. The release-preparation step must create all artifacts on
# the Linux filesystem before systemd is allowed to start this process.
RELEASE_ROOT="${MESSAGING_RELEASE_ROOT:-/opt/skincos/current/messaging-whatsapp}"
ENV_FILE="${EVOLUTION_API_ENV_FILE:-/etc/skincos/messaging-whatsapp.env}"
NODE_BIN="${NODE_BIN:-/usr/bin/node}"
IDENTITY_FILE="$RELEASE_ROOT/.skincos-release-identity-messaging-whatsapp.json"

[[ -x "$NODE_BIN" ]] || { echo "Node runtime is unavailable: $NODE_BIN" >&2; exit 1; }
[[ -d "$RELEASE_ROOT/node_modules" ]] || { echo "Native dependencies are unavailable: $RELEASE_ROOT/node_modules" >&2; exit 1; }
[[ -f "$RELEASE_ROOT/dist/main.js" ]] || { echo "Release artifact is unavailable: $RELEASE_ROOT/dist/main.js" >&2; exit 1; }
[[ -r "$IDENTITY_FILE" ]] || { echo "Messaging release identity is unavailable: $IDENTITY_FILE" >&2; exit 1; }
[[ -r "$ENV_FILE" ]] || { echo "Private WhatsApp environment is unavailable: $ENV_FILE" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo 'sha256sum is required to verify the messaging artifact.' >&2; exit 1; }

expected_artifact_digest="$("$NODE_BIN" - "$IDENTITY_FILE" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const [file] = process.argv.slice(2);
const identity = JSON.parse(fs.readFileSync(file, 'utf8'));
const canonicalJson = (value) => Array.isArray(value)
  ? '[' + value.map(canonicalJson).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
    : JSON.stringify(value);
if (identity?.schemaVersion !== 2
  || identity.module !== 'messaging-whatsapp'
  || !/^[0-9a-f]{40}$/i.test(String(identity.sourceCommit || ''))
  || !/^[0-9a-f]{40}$/i.test(String(identity.sourceTree || ''))
  || !/^[0-9a-f]{64}$/i.test(String(identity.sourceArchiveSha256 || ''))
  || !/^[0-9a-f]{64}$/i.test(String(identity.releaseManifestSha256 || ''))
  || !/^[0-9a-f]{64}$/i.test(String(identity.dependencyClosureDigest || ''))
  || !/^[0-9a-f]{64}$/i.test(String(identity.identityDigest || ''))) {
  throw new Error('Messaging release identity is malformed.');
}
const signed = { ...identity };
delete signed.identityDigest;
const observedIdentityDigest = crypto.createHash('sha256').update(canonicalJson(signed)).digest('hex');
if (observedIdentityDigest !== String(identity.identityDigest).toLowerCase()) {
  throw new Error('Messaging release identity digest is invalid.');
}
const artifacts = Array.isArray(identity.artifacts) ? identity.artifacts : [];
const artifact = artifacts.find((entry) => entry?.name === 'whatsapp-dist-main');
if (!artifact
  || artifact.id !== 'whatsapp-dist:' + String(identity.sourceCommit).toLowerCase()
  || !/^[0-9a-f]{64}$/i.test(String(artifact.digest || ''))) {
  throw new Error('Messaging release artifact identity is invalid.');
}
process.stdout.write(String(artifact.digest).toLowerCase());
NODE
)" || { echo 'Messaging release identity verification failed.' >&2; exit 1; }
actual_artifact_digest="$(sha256sum "$RELEASE_ROOT/dist/main.js" | awk '{print $1}')"
[[ "$actual_artifact_digest" == "$expected_artifact_digest" ]] || {
  echo 'Messaging release artifact digest differs from its immutable identity.' >&2
  exit 1
}

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export LOG_LEVEL="${LOG_LEVEL:-ERROR,WARN}"
export LOG_COLOR="${LOG_COLOR:-false}"
cd "$RELEASE_ROOT"
exec "$NODE_BIN" dist/main.js
