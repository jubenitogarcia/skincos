#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
N8N_GLOBAL_DIR="${N8N_GLOBAL_DIR:-$(npm root -g)/n8n}"
EDITOR_DIST_DIR="${N8N_GLOBAL_DIR}/node_modules/n8n-editor-ui/dist"
BASE_PATH_FILE="${EDITOR_DIST_DIR}/static/base-path.js"

resolve_bytes() {
	local bytes_var_name="$1"
	local mb_var_name="$2"
	local fallback_mb_var_name="${3:-}"
	local bytes_value="${!bytes_var_name:-}"
	local mb_value="${!mb_var_name:-}"
	local fallback_mb_value=""

	if [ -n "$fallback_mb_var_name" ]; then
		fallback_mb_value="${!fallback_mb_var_name:-}"
	fi

	if [ -n "$bytes_value" ]; then
		if [[ ! "$bytes_value" =~ ^[0-9]+$ ]]; then
			echo "Valor inválido para ${bytes_var_name}: ${bytes_value}" >&2
			exit 1
		fi
		echo "$bytes_value"
		return 0
	fi

	if [ -n "$mb_value" ]; then
		if [[ ! "$mb_value" =~ ^[0-9]+$ ]]; then
			echo "Valor inválido para ${mb_var_name}: ${mb_value}" >&2
			exit 1
		fi
		echo $((mb_value * 1024 * 1024))
		return 0
	fi

	if [ -n "$fallback_mb_value" ]; then
		if [[ ! "$fallback_mb_value" =~ ^[0-9]+$ ]]; then
			echo "Valor inválido para ${fallback_mb_var_name}: ${fallback_mb_value}" >&2
			exit 1
		fi
		echo $((fallback_mb_value * 1024 * 1024))
		return 0
	fi

	echo ""
}

patch_base_path() {
	local pinned_bytes="$1"
	local workflow_bytes="$2"

	if [ ! -f "$BASE_PATH_FILE" ]; then
		echo "⚠️  Arquivo não encontrado: ${BASE_PATH_FILE}"
		return 0
	fi

	cat >"$BASE_PATH_FILE" <<EOF
window.BASE_PATH = '/{{BASE_PATH}}/';
window.maxPinnedDataSize = ${pinned_bytes};
window.maxWorkflowSize = ${workflow_bytes};
EOF
}

patch_use_pinned_data_asset() {
	local asset

	asset="$(find "${EDITOR_DIST_DIR}/assets" -maxdepth 1 -name 'usePinnedData-*.js' | head -n 1)"
	if [ -z "$asset" ] || [ ! -f "$asset" ]; then
		echo "⚠️  Asset usePinnedData não encontrado em ${EDITOR_DIST_DIR}/assets"
		return 0
	fi

	if grep -q 'window.maxWorkflowSize ?? MAX_WORKFLOW_SIZE' "$asset"; then
		return 0
	fi

	perl -0pi -e 's/MAX_WORKFLOW_SIZE - MAX_EXPECTED_REQUEST_SIZE/(window.maxWorkflowSize ?? MAX_WORKFLOW_SIZE) - MAX_EXPECTED_REQUEST_SIZE/g' "$asset"
}

main() {
	if [ ! -d "$EDITOR_DIST_DIR" ]; then
		echo "⚠️  n8n-editor-ui não encontrado em ${EDITOR_DIST_DIR}"
		return 0
	fi

	local pinned_bytes workflow_bytes
	pinned_bytes="$(resolve_bytes N8N_MAX_PINNED_DATA_SIZE_BYTES N8N_MAX_PINNED_DATA_SIZE_MB N8N_PAYLOAD_SIZE_MAX)"
	workflow_bytes="$(resolve_bytes N8N_MAX_WORKFLOW_SIZE_BYTES N8N_MAX_WORKFLOW_SIZE_MB N8N_PAYLOAD_SIZE_MAX)"

	if [ -z "$pinned_bytes" ] || [ -z "$workflow_bytes" ]; then
		echo "ℹ️  Overrides de tamanho do editor do n8n não configurados; usando defaults do n8n."
		return 0
	fi

	patch_base_path "$pinned_bytes" "$workflow_bytes"
	patch_use_pinned_data_asset

	echo "✅ Runtime do editor do n8n ajustado:"
	echo "   • maxPinnedDataSize: $((pinned_bytes / 1024 / 1024)) MB"
	echo "   • maxWorkflowSize: $((workflow_bytes / 1024 / 1024)) MB"
}

main "$@"
