#!/usr/bin/env bash
set -euo pipefail

# Script para resetar todos os contextos e contas do WhatsApp Gateway
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY_DIR="$ROOT_DIR/whatsapp-gateway"
STORE_FILE="$GATEWAY_DIR/context_store.json"

if [[ -f "$STORE_FILE" ]]; then
  echo "[reset] Removendo $STORE_FILE (persistência de contextos e contas)"
  rm -f "$STORE_FILE"
else
  echo "[reset] Nenhum arquivo de contexto encontrado para remover."
fi

# Opcional: limpar outros arquivos de estado customizados aqui

echo "[reset] Contextos e contas resetados. Ao reiniciar, tudo será zerado."
