#!/bin/bash

# 🔄 ATUALIZAR CAMINHOS - Após transferência para pasta mãe
# Script para atualizar todos os caminhos nos arquivos

echo "🔄 ATUALIZANDO CAMINHOS APÓS TRANSFERÊNCIA"
echo "=========================================="

BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
OLD_PATH="${OLD_PATH:-/Users/jubenitogarcia/Automation/WhatsApp/whatsapp-web.js}"
OLD_PATH_ALT="${OLD_PATH_ALT:-/Users/jubenitogarcia/Automation/WhatsApp}"
NEW_PATH="${NEW_PATH:-$BOT_DIR}"

echo "📁 Caminho antigo: $OLD_PATH"
echo "📁 Caminho novo: $NEW_PATH"
echo ""

# Lista de arquivos a serem atualizados
FILES_TO_UPDATE=(
    "fix-terminal.sh"
    "fix-terminal-simple.sh"
    "fix-final.sh"
    "SOLUCAO_TERMINAL_RAPIDA.md"
    "INSTRUCOES_TERMINAL_CORRECAO.md"
    "ENDERECOS_ACESSO.md"
    "check-network.sh"
    "teste_agent_zero.py"
    "agent_zero_whatsapp.py"
)

echo "🔧 Atualizando arquivos:"
for file in "${FILES_TO_UPDATE[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✅ Atualizando: $file"
        sed -i.bak "s|$OLD_PATH|$NEW_PATH|g" "$file"
        sed -i.bak "s|$OLD_PATH_ALT|$NEW_PATH|g" "$file"
        rm -f "$file.bak" 2>/dev/null
    else
        echo "  ⚠️  Arquivo não encontrado: $file"
    fi
done

echo ""
echo "🎯 ATUALIZANDO ALIASES NO .zshrc..."

# Atualizar aliases no .zshrc se existirem
if [ -f "$HOME/.zshrc" ]; then
    if grep -q "$OLD_PATH" "$HOME/.zshrc" || grep -q "$OLD_PATH_ALT" "$HOME/.zshrc"; then
        echo "  ✅ Atualizando aliases no .zshrc"
        sed -i.bak "s|$OLD_PATH|$NEW_PATH|g" "$HOME/.zshrc"
        sed -i.bak "s|$OLD_PATH_ALT|$NEW_PATH|g" "$HOME/.zshrc"
        rm -f "$HOME/.zshrc.bak" 2>/dev/null
    else
        echo "  ℹ️  Nenhum alias encontrado no .zshrc"
    fi
else
    echo "  ⚠️  .zshrc não encontrado"
fi

echo ""
echo "✅ ATUALIZAÇÃO CONCLUÍDA!"
echo "========================"

echo ""
echo "🧪 TESTANDO FUNCIONALIDADES:"
echo ""

# Testar bot-manager
if [ -x "./bot-manager.sh" ]; then
    echo "✅ bot-manager.sh executável"
    echo "🔍 Testando status..."
    ./bot-manager.sh status | head -5
else
    echo "❌ bot-manager.sh não encontrado ou sem permissão"
fi

echo ""
echo "📋 COMANDOS ATUALIZADOS:"
echo "  ./bot-manager.sh start"
echo "  ./bot-manager.sh status"
echo "  ./bot-manager.sh logs"
echo ""
echo "🎯 NOVO DIRETÓRIO DE TRABALHO:"
echo "  $NEW_PATH"
echo ""
echo "💡 Para recarregar aliases:"
echo "  source ~/.zshrc"
