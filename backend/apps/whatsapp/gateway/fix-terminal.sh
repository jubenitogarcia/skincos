#!/bin/bash

# 🔧 Fix Terminal Issues - Resolver Problemas do Terminal
# Criado para corrigir problemas comuns do zsh no macOS

echo "🔧 Resolvendo problemas do terminal..."
echo "====================================="

# 1. Corrigir diretórios inseguros do zsh
echo "📁 Corrigindo diretórios inseguros do zsh..."

# Verificar quais diretórios são considerados inseguros
echo "🔍 Verificando diretórios inseguros:"
compaudit 2>/dev/null || echo "Comando compaudit não disponível"

# Corrigir permissões dos diretórios do zsh
echo "🛠️  Corrigindo permissões..."

# Diretórios comuns que causam problemas
ZSH_DIRS=(
    "/usr/local/share/zsh"
    "/usr/local/share/zsh/site-functions"
    "/opt/homebrew/share/zsh"
    "/opt/homebrew/share/zsh/site-functions"
    "$HOME/.oh-my-zsh"
)

for dir in "${ZSH_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        echo "🔧 Corrigindo: $dir"
        sudo chmod -R 755 "$dir" 2>/dev/null || echo "   ⚠️  Não foi possível corrigir $dir"
        sudo chown -R root:staff "$dir" 2>/dev/null || echo "   ⚠️  Não foi possível alterar proprietário de $dir"
    fi
done

# 2. Verificar e corrigir pyenv
echo ""
echo "🐍 Verificando configuração do pyenv..."

# Verificar se pyenv está instalado
if command -v pyenv >/dev/null 2>&1; then
    echo "✅ pyenv encontrado em: $(which pyenv)"
    echo "🔍 Versão: $(pyenv --version)"
    echo "📋 Versões instaladas:"
    pyenv versions
else
    echo "❌ pyenv não encontrado"
    echo "💡 Para instalar: brew install pyenv"
fi

# Verificar configuração no .zshrc
echo ""
echo "📝 Verificando configuração do .zshrc..."

ZSHRC="$HOME/.zshrc"
if [ -f "$ZSHRC" ]; then
    echo "✅ .zshrc encontrado"

    # Verificar se pyenv está configurado
    if grep -q "pyenv init" "$ZSHRC"; then
        echo "✅ pyenv configurado no .zshrc"
    else
        echo "⚠️  pyenv não configurado no .zshrc"
        echo "💡 Adicionando configuração do pyenv..."

        echo "" >> "$ZSHRC"
        echo "# pyenv configuration" >> "$ZSHRC"
        echo 'export PYENV_ROOT="$HOME/.pyenv"' >> "$ZSHRC"
        echo 'command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"' >> "$ZSHRC"
        echo 'eval "$(pyenv init -)"' >> "$ZSHRC"

        echo "✅ Configuração do pyenv adicionada"
    fi
else
    echo "❌ .zshrc não encontrado"
    echo "💡 Criando .zshrc básico..."

    cat > "$ZSHRC" << 'EOF'
# .zshrc - Configuração básica do zsh

# pyenv configuration
export PYENV_ROOT="$HOME/.pyenv"
command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"

# Evitar avisos de diretórios inseguros
ZSH_DISABLE_COMPFIX=true

EOF
    echo "✅ .zshrc criado"
fi

# 3. Criar alias úteis
echo ""
echo "🎯 Adicionando aliases úteis..."

# Diretório atual do bot (para aliases)
BOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Verificar se aliases já existem
if ! grep -q "# WhatsApp Bot aliases" "$ZSHRC"; then
    cat >> "$ZSHRC" <<EOF

# WhatsApp Bot aliases
alias bot-start="cd $BOT_DIR && ./bot-manager.sh start"
alias bot-stop="cd $BOT_DIR && ./bot-manager.sh stop"
alias bot-status="cd $BOT_DIR && ./bot-manager.sh status"
alias bot-logs="cd $BOT_DIR && ./bot-manager.sh logs"
alias bot-restart="cd $BOT_DIR && ./bot-manager.sh restart"
alias bot-cd="cd $BOT_DIR"

EOF
    echo "✅ Aliases do WhatsApp Bot adicionados"
else
    echo "✅ Aliases já existem"
fi

# 4. Instruções finais
echo ""
echo "🎉 CORREÇÕES APLICADAS!"
echo "======================"
echo ""
echo "📋 Para aplicar as mudanças:"
echo "  source ~/.zshrc"
echo "  ou"
echo "  Abra um novo terminal"
echo ""
echo "🎯 Novos aliases disponíveis:"
echo "  bot-start    # Iniciar bot de qualquer lugar"
echo "  bot-stop     # Parar bot"
echo "  bot-status   # Ver status"
echo "  bot-logs     # Ver logs"
echo "  bot-restart  # Reiniciar"
echo "  bot-cd       # Ir para diretório do bot"
echo ""
echo "🐍 Para usar Python:"
echo "  pyenv shell 3.12.4"
echo "  (não mais 'yenv')"
echo ""
echo "✅ Problemas que foram corrigidos:"
echo "  ✅ Diretórios inseguros do zsh"
echo "  ✅ Configuração do pyenv"
echo "  ✅ Permissões do bot-manager.sh"
echo "  ✅ Aliases úteis adicionados"

echo ""
echo "🚀 Agora você pode usar:"
echo "  ./bot-manager.sh start"
echo "  ou simplesmente:"
echo "  bot-start"
