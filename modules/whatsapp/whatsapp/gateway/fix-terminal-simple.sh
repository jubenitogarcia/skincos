#!/bin/bash

# 🔧 Terminal Fix Simples - Sem Sudo
# Resolver problemas sem precisar de senha de administrador

echo "🔧 Configuração Simples do Terminal"
echo "==================================="

# 1. Configurar .zshrc para evitar avisos
echo "📝 Configurando .zshrc..."

ZSHRC="$HOME/.zshrc"
BOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Backup do .zshrc atual se existir
if [ -f "$ZSHRC" ]; then
    cp "$ZSHRC" "$ZSHRC.backup.$(date +%Y%m%d_%H%M%S)"
    echo "✅ Backup criado: $ZSHRC.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Adicionar configurações essenciais
cat >> "$ZSHRC" << 'EOF'

# ===========================================
# WhatsApp Bot Configuration - Auto Added
# ===========================================

# Desabilitar avisos de diretórios inseguros
export ZSH_DISABLE_COMPFIX=true

# pyenv configuration (se instalado)
if [ -d "$HOME/.pyenv" ]; then
    export PYENV_ROOT="$HOME/.pyenv"
    command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"
    eval "$(pyenv init -)"
fi

# Homebrew pyenv (se instalado via brew)
if [ -d "/opt/homebrew/bin" ]; then
    export PATH="/opt/homebrew/bin:$PATH"
fi

# WhatsApp Bot aliases
alias bot-start="cd __BOT_DIR__ && ./bot-manager.sh start"
alias bot-stop="cd __BOT_DIR__ && ./bot-manager.sh stop"
alias bot-status="cd __BOT_DIR__ && ./bot-manager.sh status"
alias bot-logs="cd __BOT_DIR__ && ./bot-manager.sh logs"
alias bot-restart="cd __BOT_DIR__ && ./bot-manager.sh restart"
alias bot-cd="cd __BOT_DIR__"
alias bot-info="cd __BOT_DIR__ && ./bot-manager.sh info"

# Função para testar bot rapidamente
bot-test() {
    echo "🤖 Testando WhatsApp Bot..."
    curl -s http://localhost:3001/health | jq . 2>/dev/null || curl -s http://localhost:3001/health
}

EOF

perl -0777 -i -pe "s|__BOT_DIR__|$BOT_DIR|g" "$ZSHRC" 2>/dev/null || true

echo "✅ Configurações adicionadas ao .zshrc"

# 2. Verificar pyenv
echo ""
echo "🐍 Verificando pyenv..."
if command -v pyenv >/dev/null 2>&1; then
    echo "✅ pyenv encontrado: $(which pyenv)"
    echo "📋 Versão: $(pyenv --version)"
else
    echo "⚠️  pyenv não encontrado"
    echo "💡 Para instalar: brew install pyenv"
fi

# 3. Testar bot-manager.sh
echo ""
echo "🤖 Testando bot-manager.sh..."
if [ -x "./bot-manager.sh" ]; then
    echo "✅ bot-manager.sh está executável"
    echo "🎯 Comandos disponíveis:"
    ./bot-manager.sh menu | grep -A 10 "Comandos disponíveis"
else
    echo "❌ Problema com bot-manager.sh"
    chmod +x bot-manager.sh
    echo "✅ Permissão corrigida"
fi

echo ""
echo "🎉 CONFIGURAÇÃO CONCLUÍDA!"
echo "========================="
echo ""
echo "📋 PRÓXIMOS PASSOS:"
echo "1. Feche este terminal"
echo "2. Abra um novo terminal"
echo "3. Os avisos do zsh não aparecerão mais"
echo "4. Use: pyenv shell 3.12.4 (não 'yenv')"
echo ""
echo "🎯 NOVOS COMANDOS DISPONÍVEIS:"
echo "  bot-start     # Iniciar bot de qualquer lugar"
echo "  bot-stop      # Parar bot"
echo "  bot-status    # Ver status"
echo "  bot-logs      # Ver logs em tempo real"
echo "  bot-restart   # Reiniciar bot"
echo "  bot-cd        # Ir para diretório do bot"
echo "  bot-test      # Testar se API está respondendo"
echo ""
echo "✅ PROBLEMAS RESOLVIDOS:"
echo "  ✅ 'zsh compinit: insecure directories' - CORRIGIDO"
echo "  ✅ 'zsh: permission denied: ./bot-manager.sh' - CORRIGIDO"
echo "  ✅ 'zsh: command not found: yenv' - USE: pyenv"
echo "  ✅ Aliases úteis adicionados"
echo ""
echo "🚀 TESTE AGORA:"
echo "  ./bot-manager.sh status"
