#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
PREPARE="$ROOT_DIR/scripts/runtime/prepare-messaging-whatsapp-release.sh"
CONTRACT="$ROOT_DIR/scripts/runtime/messaging-whatsapp-release-contract.mjs"
CANDIDATE_WORKFLOW="$ROOT_DIR/.github/workflows/prepare-release-candidate.yml"
CONTRACT_WORKFLOW="$ROOT_DIR/.github/workflows/messaging-whatsapp-release-contract.yml"

# The WSL wrapper's Git routing is required to read ROOT_DIR because the
# worktree metadata is Windows-owned. The dynamic candidate below is created
# only under /tmp with every inherited GIT_* variable removed, so its fixture
# Git repository cannot rewrite shared worktree configuration.

bash -n "$PREPARE"
grep -F -- 'git checkout --detach "$release_sha"' "$CANDIDATE_WORKFLOW" >/dev/null || {
  echo 'Release candidate workflow must load the requested immutable source before deriving closure or manifest.' >&2
  exit 1
}
grep -F -- '> release-candidate/messaging-whatsapp-closure.json' "$CANDIDATE_WORKFLOW" >/dev/null || {
  echo 'Release candidate workflow must persist the messaging closure inside the candidate artifact.' >&2
  exit 1
}
for path in \
  'ops/governance/global-coordination-core.mjs' \
  'ops/codex/risk-policy.json' \
  'scripts/codex-autonomy-lib.mjs' \
  'scripts/codex-global-coordinator.mjs' \
  'scripts/codex-global-coordination-workflow.mjs' \
  'scripts/codex-release-manifest.mjs'; do
  [[ "$(grep -Fc -- "      - \"$path\"" "$CONTRACT_WORKFLOW")" -eq 2 ]] || {
    echo "Messaging contract CI must cover both path filters for $path." >&2
    exit 1
  }
done

required=(
  '--release-candidate'
  '--predecessor-release'
  'release-source-<SHA>'
  'source.tar.gz'
  'source.sha256'
  'release-manifest.json'
  'messaging-whatsapp-closure.json'
  'must already be on native Linux storage'
  'IMMUTABLE_ENGINE/'
  'CALLER_CONTRACT'
  'CALLER_COORDINATION'
  'CALLER_RUNNER'
  'verify-candidate'
  'snapshot-candidate'
  'materialize-candidate'
  'SNAPSHOT_CANDIDATE'
  'assert_confined_immutable_engine'
  'IMMUTABLE_ENGINE'
  'build-identity'
  '.skincos-global-coordination-messaging-whatsapp.json'
  '.skincos-release-identity-messaging-whatsapp.json'
  '--release-identity-file "$ARTIFACT_IDENTITY_FILE"'
  '--operation promotion'
  'attested-predecessor-release'
  'external authenticated release custody'
  'source archive digest'
)

for pattern in "${required[@]}"; do
  grep -F -- "$pattern" "$PREPARE" >/dev/null || {
    echo "Missing immutable messaging preparation guard: $pattern" >&2
    exit 1
  }
done

if grep -F -- 'SOURCE_DIR=' "$PREPARE" >/dev/null \
  || grep -F -- '"$ROOT_DIR/messaging/channels/whatsapp/engine/"' "$PREPARE" >/dev/null \
  || grep -F -- 'tar -tzf' "$PREPARE" >/dev/null \
  || grep -F -- 'tar -xzf' "$PREPARE" >/dev/null; then
  echo 'Messaging preparation must not consume a checkout or worktree as engine source.' >&2
  exit 1
fi

if grep -F -- 'node "$IMMUTABLE_CONTRACT"' "$PREPARE" >/dev/null \
  || grep -F -- '"$IMMUTABLE_COORDINATION"' "$PREPARE" >/dev/null \
  || grep -F -- '"$IMMUTABLE_RUNNER"' "$PREPARE" >/dev/null; then
  echo 'Messaging preparation must not execute release-source scripts before external custody is verified.' >&2
  exit 1
fi

apply_guard_line="$(grep -n -m1 -F 'if [[ "$APPLY" == 1 ]]' "$PREPARE" | cut -d: -f1)"
snapshot_line="$(grep -n -m1 -F 'snapshot-candidate' "$PREPARE" | cut -d: -f1)"
[[ -n "$apply_guard_line" && -n "$snapshot_line" && "$apply_guard_line" -lt "$snapshot_line" ]] || {
  echo 'Messaging --apply custody gate must deny before opening a release candidate.' >&2
  exit 1
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

# Verify the caller contract against a complete archive of this worktree's
# immutable HEAD first. This covers Git's legitimate gzip SIGPIPE behavior
# after `git get-tar-commit-id` reads a large PAX header, without allowing a
# detached archive to bypass SHA, tree, digest, or closure verification.
caller_release_sha="$(git -C "$ROOT_DIR" rev-parse HEAD)"
caller_source_tree="$(git -C "$ROOT_DIR" rev-parse "${caller_release_sha}^{tree}")"
caller_candidate="$tmp_dir/release-source-$caller_release_sha"
mkdir -p "$caller_candidate"
git -C "$ROOT_DIR" archive --format=tar.gz --prefix="skincos-$caller_release_sha/" "$caller_release_sha" >"$caller_candidate/source.tar.gz"
caller_archive_digest="$(sha256sum "$caller_candidate/source.tar.gz" | awk '{print $1}')"
printf '%s\n' "$caller_archive_digest" >"$caller_candidate/source.sha256"
/usr/bin/node - "$caller_candidate/release.json" "$caller_release_sha" "$caller_source_tree" "$caller_archive_digest" <<'NODE'
const fs = require('fs');
const [file, sourceSha, sourceTree, sourceArchiveSha256] = process.argv.slice(2);
fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, sourceSha, sourceTree, sourceArchiveSha256 }, null, 2) + '\n');
NODE
/usr/bin/node "$ROOT_DIR/scripts/codex-global-coordinator.mjs" closure \
  --module messaging-whatsapp --source "$caller_release_sha" >"$caller_candidate/messaging-whatsapp-closure.json"
/usr/bin/node "$ROOT_DIR/scripts/codex-release-manifest.mjs" \
  --source "$caller_release_sha" --base "${caller_release_sha}^" --allow-empty \
  --artifact "source-archive=$caller_archive_digest" --output "$caller_candidate/release-manifest.json"
node "$CONTRACT" verify-candidate \
  --candidate "$caller_candidate" --release-sha "$caller_release_sha" >/dev/null

if apply_output="$(MESSAGING_RELEASE_ID="$caller_release_sha" \
  bash "$PREPARE" --release-candidate "$tmp_dir/must-not-be-opened" --apply 2>&1)"; then
  echo 'Messaging --apply unexpectedly bypassed the external custody gate.' >&2
  exit 1
fi
grep -F -- 'external authenticated release custody' <<<"$apply_output" >/dev/null || {
  echo 'Messaging --apply opened an untrusted candidate before the custody gate.' >&2
  exit 1
}

source_repo="$tmp_dir/source"
mkdir -p "$source_repo"
git -C "$ROOT_DIR" archive --format=tar HEAD | tar -xf - -C "$source_repo"

# Overlay the in-flight contract under test, then make a native temporary Git
# source. This lets prepare verify the same immutable contract after extraction
# without requiring a commit in the caller worktree.
cp "$ROOT_DIR/scripts/runtime/messaging-whatsapp-release-contract.mjs" \
  "$source_repo/scripts/runtime/messaging-whatsapp-release-contract.mjs"
declare -a git_env_unsets=()
while IFS= read -r environment_entry; do
  environment_name="${environment_entry%%=*}"
  if [[ "${environment_name^^}" == GIT_* ]]; then
    git_env_unsets+=("-u" "$environment_name")
  fi
done < <(env)
git_isolated() {
  env "${git_env_unsets[@]}" git "$@"
}
node_isolated() {
  env "${git_env_unsets[@]}" /usr/bin/node "$@"
}
git_isolated init --quiet "$source_repo"
git_isolated -C "$source_repo" -c user.email=messaging-contract@example.invalid \
  -c user.name='Messaging Contract' -c commit.gpgSign=false commit --quiet --allow-empty -m base
git_isolated -C "$source_repo" add --all
git_isolated -C "$source_repo" -c user.email=messaging-contract@example.invalid \
  -c user.name='Messaging Contract' -c commit.gpgSign=false commit --quiet -m candidate
release_sha="$(git_isolated -C "$source_repo" rev-parse HEAD)"
source_tree="$(git_isolated -C "$source_repo" rev-parse "${release_sha}^{tree}")"
candidate="$tmp_dir/release-source-$release_sha"
mkdir -p "$candidate"
git_isolated -C "$source_repo" archive --format=tar.gz --prefix="skincos-$release_sha/" "$release_sha" >"$candidate/source.tar.gz"
archive_digest="$(sha256sum "$candidate/source.tar.gz" | awk '{print $1}')"
printf '%s\n' "$archive_digest" >"$candidate/source.sha256"
/usr/bin/node - "$candidate/release.json" "$release_sha" "$source_tree" "$archive_digest" <<'NODE'
const fs = require('fs');
const [file, sourceSha, sourceTree, sourceArchiveSha256] = process.argv.slice(2);
fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, sourceSha, sourceTree, sourceArchiveSha256 }, null, 2) + '\n');
NODE
node_isolated "$source_repo/scripts/codex-global-coordinator.mjs" closure \
  --module messaging-whatsapp --source "$release_sha" >"$candidate/messaging-whatsapp-closure.json"
node_isolated "$source_repo/scripts/codex-release-manifest.mjs" \
  --source "$release_sha" --base "${release_sha}^" --allow-empty \
  --artifact "source-archive=$archive_digest" --output "$candidate/release-manifest.json"
output="$(MESSAGING_RELEASE_ID="$release_sha" \
  MESSAGING_RELEASE_BASE="$tmp_dir/releases" \
  MESSAGING_CURRENT_LINK="$tmp_dir/current/messaging-whatsapp" \
  bash "$PREPARE" --release-candidate "$candidate")"
grep -Fx 'dry_run=true' <<<"$output" >/dev/null
grep -Fx 'apply_requires=attested-predecessor-release' <<<"$output" >/dev/null
grep -Fx 'apply_requires=external-authenticated-release-custody-run-artifact-digest' <<<"$output" >/dev/null

# A self-consistent candidate can put arbitrary JavaScript at its own release
# entrypoint. Dry-run must parse and reconstruct that source as data only; it
# may never run candidate-controlled contract/coordination/runner code before
# externally authenticated custody exists.
malicious_marker="$tmp_dir/candidate-contract-executed"
/usr/bin/node - "$source_repo/scripts/runtime/messaging-whatsapp-release-contract.mjs" "$malicious_marker" <<'NODE'
const fs = require('fs');
const [file, marker] = process.argv.slice(2);
fs.writeFileSync(file, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "executed");\nthrow new Error("candidate contract must not execute");\n`);
NODE
git_isolated -C "$source_repo" add --all
git_isolated -C "$source_repo" -c user.email=messaging-contract@example.invalid \
  -c user.name='Messaging Contract' -c commit.gpgSign=false commit --quiet -m malicious-candidate-contract
malicious_release_sha="$(git_isolated -C "$source_repo" rev-parse HEAD)"
malicious_source_tree="$(git_isolated -C "$source_repo" rev-parse "${malicious_release_sha}^{tree}")"
malicious_candidate="$tmp_dir/release-source-$malicious_release_sha"
mkdir -p "$malicious_candidate"
git_isolated -C "$source_repo" archive --format=tar.gz --prefix="skincos-$malicious_release_sha/" "$malicious_release_sha" >"$malicious_candidate/source.tar.gz"
malicious_archive_digest="$(sha256sum "$malicious_candidate/source.tar.gz" | awk '{print $1}')"
printf '%s\n' "$malicious_archive_digest" >"$malicious_candidate/source.sha256"
/usr/bin/node - "$malicious_candidate/release.json" "$malicious_release_sha" "$malicious_source_tree" "$malicious_archive_digest" <<'NODE'
const fs = require('fs');
const [file, sourceSha, sourceTree, sourceArchiveSha256] = process.argv.slice(2);
fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, sourceSha, sourceTree, sourceArchiveSha256 }, null, 2) + '\n');
NODE
node_isolated "$source_repo/scripts/codex-global-coordinator.mjs" closure \
  --module messaging-whatsapp --source "$malicious_release_sha" >"$malicious_candidate/messaging-whatsapp-closure.json"
node_isolated "$source_repo/scripts/codex-release-manifest.mjs" \
  --source "$malicious_release_sha" --base "${malicious_release_sha}^" --allow-empty \
  --artifact "source-archive=$malicious_archive_digest" --output "$malicious_candidate/release-manifest.json"
malicious_output="$(MESSAGING_RELEASE_ID="$malicious_release_sha" \
  MESSAGING_RELEASE_BASE="$tmp_dir/malicious-releases" \
  MESSAGING_CURRENT_LINK="$tmp_dir/malicious-current/messaging-whatsapp" \
  bash "$PREPARE" --release-candidate "$malicious_candidate")"
grep -Fx 'dry_run=true' <<<"$malicious_output" >/dev/null
[[ ! -e "$malicious_marker" ]] || {
  echo 'Candidate-controlled contract executed before custody verification.' >&2
  exit 1
}

echo 'Messaging WhatsApp immutable release preparation checks passed'
