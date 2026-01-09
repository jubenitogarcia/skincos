#!/bin/bash

# ========================================
# SCRIPT PARA INICIAR WEBHOOK SERVER
# ========================================

echo "📟 Iniciando Webhook Server..."
echo ""
echo "Verificando configurações..."

# Verificar se .env existe
if [ ! -f .env ]; then
    echo "❌ Arquivo .env não encontrado!"
    echo "   Crie o arquivo .env com as configurações necessárias"
    exit 1
fi

# Verificar se GITHUB_TOKEN está configurado
if ! grep -q "GITHUB_TOKEN=ghp_" .env; then
    echo "⚠️  GITHUB_TOKEN não parece estar configurado no .env"
    echo "   Verifique o arquivo .env"
fi

echo ""
echo "✅ Iniciando servidor..."
echo ""

# Iniciar webhook server
python webhook_server.py
