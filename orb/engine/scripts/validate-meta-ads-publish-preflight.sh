#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Meta Ads Publish preflight (read-only) =="
sudo -n -u postgres node "$ROOT_DIR/scripts/inspect-meta-ads-publish-version-alignment.js" --strict

echo "== live/source synchronization =="
VIDEO_PROCESSOR_RUNTIME_PATH="${META_ADS_VIDEO_PROCESSOR_PATH:-/var/lib/skincos-runtime/orb/scripts/meta-ads/process-video-asset.js}"
VIDEO_PROCESSOR_RUNTIME_SHA256="$(sudo -n -u skincos sha256sum "$VIDEO_PROCESSOR_RUNTIME_PATH" | awk '{print $1}')"
META_ADS_VIDEO_PROCESSOR_PATH="$VIDEO_PROCESSOR_RUNTIME_PATH" \
META_ADS_VIDEO_PROCESSOR_RUNTIME_SHA256="$VIDEO_PROCESSOR_RUNTIME_SHA256" \
  sudo -n -u postgres env \
    META_ADS_VIDEO_PROCESSOR_PATH="$VIDEO_PROCESSOR_RUNTIME_PATH" \
    META_ADS_VIDEO_PROCESSOR_RUNTIME_SHA256="$VIDEO_PROCESSOR_RUNTIME_SHA256" \
    node "$ROOT_DIR/scripts/validate-meta-ads-publish-preflight.js"

echo "== orb health =="
curl -fsS --max-time 15 "${N8N_HEALTH_URL:-http://127.0.0.1:5678/healthz}"
printf '\n'
curl -fsS --max-time 20 "${ORB_PUBLIC_HEALTH_URL:-https://orb.skincos.com.br/healthz}"
printf '\n'

echo "Meta Ads Publish preflight OK. No Meta mutation or service restart was performed."
