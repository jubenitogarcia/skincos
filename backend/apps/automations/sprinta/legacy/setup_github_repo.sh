#!/bin/bash

# Script para criar e enviar o repositório Sprinta Scraper para o GitHub

set -e  # Parar se houver erros

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     🏃‍♂️ Sprinta Scraper - Setup do Repositório GitHub        ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Verificar se está dentro do diretório correto
if [ ! -f "sprinta_automation.py" ]; then
    echo "❌ Erro: Este script deve ser executado no diretório do Sprinta"
    exit 1
fi

# Verificar se git está instalado
if ! command -v git &> /dev/null; then
    echo "❌ Erro: Git não está instalado"
    echo "💡 Instale com: brew install git"
    exit 1
fi

# Verificar se gh (GitHub CLI) está instalado
if ! command -v gh &> /dev/null; then
    echo "⚠️  GitHub CLI (gh) não encontrado"
    echo "💡 Instalando com Homebrew..."
    brew install gh || {
        echo "❌ Erro ao instalar gh"
        echo "💡 Instale manualmente: brew install gh"
        exit 1
    }
fi

# Verificar autenticação do GitHub
echo "🔐 Verificando autenticação no GitHub..."
if ! gh auth status &> /dev/null; then
    # Verificar se existe GITHUB_TOKEN no ambiente
    if [ -n "$GITHUB_TOKEN" ]; then
        echo "✅ Token GITHUB_TOKEN detectado no ambiente"
        echo "� Usando token existente para autenticação"
    else
        echo "�🔑 Fazendo login no GitHub..."
        gh auth login
    fi
else
    echo "✅ Já autenticado no GitHub"
fi

# Solicitar nome do repositório
read -p "📝 Nome do repositório (padrão: Sprinta-Scraper): " REPO_NAME
REPO_NAME=${REPO_NAME:-Sprinta-Scraper}

# Solicitar descrição
read -p "📝 Descrição do repositório: " REPO_DESC
REPO_DESC=${REPO_DESC:-"Automação de inscrições no Sprinta usando Selenium WebDriver"}

# Solicitar visibilidade
echo ""
echo "🔒 Visibilidade do repositório:"
echo "   1) Público (qualquer pessoa pode ver)"
echo "   2) Privado (apenas você e colaboradores)"
read -p "Escolha (1 ou 2, padrão: 1): " VISIBILITY_CHOICE
VISIBILITY_CHOICE=${VISIBILITY_CHOICE:-1}

if [ "$VISIBILITY_CHOICE" = "2" ]; then
    VISIBILITY="--private"
else
    VISIBILITY="--public"
fi

echo ""
echo "📋 Configuração:"
echo "   Nome: $REPO_NAME"
echo "   Descrição: $REPO_DESC"
echo "   Visibilidade: $([ "$VISIBILITY" = "--public" ] && echo "Público" || echo "Privado")"
echo ""
read -p "Continuar? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ]; then
    echo "❌ Cancelado"
    exit 0
fi

echo ""
echo "🚀 Iniciando setup..."

# Inicializar git se necessário
if [ ! -d ".git" ]; then
    echo "📦 Inicializando repositório Git..."
    git init
    echo "✅ Git inicializado"
fi

# Adicionar arquivos
echo "📁 Adicionando arquivos..."
git add .

# Fazer commit inicial
echo "💾 Criando commit inicial..."
git commit -m "Initial commit: Sprinta Scraper automation

- Automação completa de inscrições no Sprinta
- Suporte a sessão persistente (evita múltiplos logins)
- Modo debug e modo rápido (73% mais rápido)
- GitHub Actions para processamento na nuvem
- API para integração externa via webhook
- Documentação completa em português
" || {
    echo "⚠️  Nenhuma mudança para commit ou já commitado"
}

# Criar repositório no GitHub
echo "🌐 Criando repositório no GitHub..."
gh repo create "$REPO_NAME" $VISIBILITY --description "$REPO_DESC" --source=. --remote=origin --push || {
    echo "⚠️  Repositório pode já existir, tentando adicionar remote..."
    GITHUB_USER=$(gh api user -q .login)
    git remote add origin "https://github.com/$GITHUB_USER/$REPO_NAME.git" 2>/dev/null || {
        echo "⚠️  Remote 'origin' já existe, atualizando..."
        git remote set-url origin "https://github.com/$GITHUB_USER/$REPO_NAME.git"
    }
    git branch -M main
    git push -u origin main
}

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    ✅ REPOSITÓRIO CRIADO!                     ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

GITHUB_USER=$(gh api user -q .login)
REPO_URL="https://github.com/$GITHUB_USER/$REPO_NAME"

echo "🎉 Repositório disponível em:"
echo "   $REPO_URL"
echo ""
echo "📋 PRÓXIMOS PASSOS:"
echo ""
echo "1️⃣  Configurar Secrets do GitHub (obrigatório para GitHub Actions):"
echo "   • Acesse: $REPO_URL/settings/secrets/actions"
echo "   • Adicione os secrets:"
echo "     - SPRINTA_EMAIL: seu-email@empresa.com"
echo "     - SPRINTA_PASSWORD: sua-senha"
echo ""
echo "2️⃣  Testar GitHub Action:"
echo "   • Acesse: $REPO_URL/actions"
echo "   • Clique em 'Processar Inscrições Sprinta'"
echo "   • Clique em 'Run workflow'"
echo "   • Cole o conteúdo do CSV"
echo "   • Clique em 'Run workflow'"
echo ""
echo "3️⃣  Usar via API (opcional):"
echo "   • Crie um GitHub Token: https://github.com/settings/tokens"
echo "   • Configure o arquivo .env (veja .env.example)"
echo "   • Execute: python trigger_github_action.py participants.csv"
echo ""
echo "📚 Documentação completa no README.md"
echo ""
echo "🔗 Atalhos úteis:"
echo "   • Repositório: $REPO_URL"
echo "   • Actions: $REPO_URL/actions"
echo "   • Settings: $REPO_URL/settings"
echo "   • Secrets: $REPO_URL/settings/secrets/actions"
echo ""
echo "✅ Setup concluído com sucesso! 🎉"
