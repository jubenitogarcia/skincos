#!/bin/bash

# ========================================
# SCRIPT PARA INICIAR NGROK
# ========================================

echo "🌐 Iniciando Ngrok..."
echo ""
echo "⚠️  ATENÇÃO: A URL do ngrok VAI MUDAR toda vez que reiniciar!"
echo ""
echo "Aguarde a URL aparecer e anote..."
echo ""

# Iniciar ngrok
ngrok http 5001
