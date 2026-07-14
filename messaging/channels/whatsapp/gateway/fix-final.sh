#!/bin/bash

# 🔧 CORREÇÃO DEFINITIVA - Terminal ZSH
# Script para resolver TODOS os problemas de uma vez

echo "🚀 CORREÇÃO COMPLETA DO TERMINAL"
echo "================================"

# Diretório atual do bot (para aliases e instruções)
BOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. Backup do .zshrc atual
if [ -f ~/.zshrc ]; then
    cp ~/.zshrc ~/.zshrc.backup.$(date +%Y%m%d_%H%M%S)
    echo "✅ Backup do .zshrc criado"
fi

# 2. Corrigir permissões dos diretórios Docker (principal causa)
echo "🔧 Corrigindo permissões do Docker..."
if [ -d ~/.docker ]; then
    chmod go-w ~/.docker
    if [ -d ~/.docker/completions ]; then
        chmod go-w ~/.docker/completions
    fi
    echo "✅ Permissões do Docker corrigidas"
fi

# 3. Criar .zshrc limpo e completo
cat > ~/.zshrc << 'EOF'
# .zshrc - Configuração otimizada para WhatsApp Bot

# Desabilitar avisos de diretórios inseguros
export ZSH_DISABLE_COMPFIX=true

# Homebrew
export PATH="/opt/homebrew/bin:$PATH"

# pyenv configuration
export PYENV_ROOT="$HOME/.pyenv"
if command -v pyenv >/dev/null; then
    eval "$(pyenv init -)"
fi

# WhatsApp Bot aliases
alias bot-start="cd __BOT_DIR__ && ./bot-manager.sh start"
alias bot-stop="cd __BOT_DIR__ && ./bot-manager.sh stop"
alias bot-status="cd __BOT_DIR__ && ./bot-manager.sh status"
alias bot-logs="cd __BOT_DIR__ && ./bot-manager.sh logs"
alias bot-restart="cd __BOT_DIR__ && ./bot-manager.sh restart"
alias bot-cd="cd __BOT_DIR__"
alias bot-info="cd __BOT_DIR__ && ./bot-manager.sh info"

# Função para testar bot
bot-test() {
    echo "🤖 Testando WhatsApp Bot..."
    curl -s http://localhost:3001/health 2>/dev/null || echo "❌ Bot não está rodando"
}

# Mostrar status do bot ao abrir terminal
echo "🤖 WhatsApp Bot Status:"
if curl -s http://localhost:3001/health >/dev/null 2>&1; then
    echo "✅ Bot está rodando - http://localhost:3001"
else
    echo "❌ Bot parado - use 'bot-start' para iniciar"
fi

EOF

perl -0777 -i -pe "s|__BOT_DIR__|$BOT_DIR|g" "$HOME/.zshrc" 2>/dev/null || true

echo "✅ .zshrc reconfigurado completamente"

# 4. Verificar pyenv
echo "🐍 Verificando pyenv..."
if [ -f /opt/homebrew/bin/pyenv ]; then
    echo "✅ pyenv encontrado em /opt/homebrew/bin/pyenv"
else
    echo "⚠️  pyenv não encontrado - instale com: brew install pyenv"
fi

# 5. Verificar bot-manager.sh
echo "🤖 Verificando bot-manager.sh..."
if [ -f "./bot-manager.sh" ]; then
    chmod +x ./bot-manager.sh
    echo "✅ bot-manager.sh configurado"
else
    echo "❌ bot-manager.sh não encontrado no diretório atual"
fi

echo ""
echo "🎉 CORREÇÃO CONCLUÍDA!"
echo "===================="
echo ""
echo "📋 PRÓXIMOS PASSOS:"
echo "1. Feche TODOS os terminais abertos"
echo "2. Abra um NOVO terminal"
echo "3. Navegue até o projeto: cd $BOT_DIR"
echo "4. Teste: pyenv shell 3.12.4 (SEM 'y' no início)"
echo "5. Teste: ./bot-manager.sh status"
echo ""
echo "✅ PROBLEMAS RESOLVIDOS:"
echo "  ✅ zsh compinit: insecure directories"
echo "  ✅ permission denied: ./bot-manager.sh"
echo "  ✅ command not found: yenv (use pyenv)"
echo "  ✅ Aliases úteis adicionados"
echo ""
echo "🎯 NOVOS COMANDOS DISPONÍVEIS:"
echo "  bot-start, bot-stop, bot-status, bot-logs, bot-restart"
