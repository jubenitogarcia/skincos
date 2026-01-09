#!/bin/bash

# Script simplificado para criar repositório GitHub Sprinta Scraper
# Usa apenas Git (sem dependência do GitHub CLI)

set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     🏃‍♂️ Sprinta Scraper - Setup Simplificado do GitHub       ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Verificar se está dentro do diretório correto
if [ ! -f "sprinta_automation.py" ]; then
    echo "❌ Erro: Execute este script no diretório do Sprinta"
    exit 1
fi

# Verificar se git está instalado
if ! command -v git &> /dev/null; then
    echo "❌ Erro: Git não está instalado"
    echo "💡 Instale com: brew install git"
    exit 1
fi

# Solicitar informações
echo "📝 Configuração do repositório"
echo ""
read -p "Nome do seu usuário GitHub: " GITHUB_USER
read -p "Nome do repositório (padrão: Sprinta-Scraper): " REPO_NAME
REPO_NAME=${REPO_NAME:-Sprinta-Scraper}

echo ""
echo "📋 Resumo:"
echo "   Usuário: $GITHUB_USER"
echo "   Repositório: $REPO_NAME"
echo "   URL: https://github.com/$GITHUB_USER/$REPO_NAME"
echo ""
read -p "Continuar? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ]; then
    echo "❌ Cancelado"
    exit 0
fi

echo ""
echo "🚀 Iniciando setup..."
echo ""

# Inicializar git se necessário
if [ ! -d ".git" ]; then
    echo "📦 Inicializando repositório Git..."
    git init
    echo "✅ Git inicializado"
else
    echo "✅ Repositório Git já existe"
fi

# Configurar remote
echo "🔗 Configurando remote..."
REPO_URL="https://github.com/$GITHUB_USER/$REPO_NAME.git"

if git remote | grep -q "^origin$"; then
    echo "⚠️  Remote 'origin' já existe, atualizando URL..."
    git remote set-url origin "$REPO_URL"
else
    git remote add origin "$REPO_URL"
fi
echo "✅ Remote configurado: $REPO_URL"

# Adicionar arquivos
echo "📁 Adicionando arquivos..."
git add .
echo "✅ Arquivos adicionados"

# Fazer commit
echo "💾 Criando commit..."
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
echo "✅ Commit criado"

# Criar branch main e fazer push
echo "🌐 Enviando para GitHub..."
git branch -M main

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚠️  ATENÇÃO: O repositório precisa existir no GitHub!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Você tem duas opções:"
echo ""
echo "1️⃣  Criar manualmente (Recomendado se ainda não existe):"
echo "   • Abra: https://github.com/new"
echo "   • Nome: $REPO_NAME"
echo "   • Descrição: Automação de inscrições no Sprinta"
echo "   • Não adicione README, .gitignore ou licença"
echo "   • Clique em 'Create repository'"
echo ""
echo "2️⃣  Usar repositório existente:"
echo "   • Se já criou antes, pode prosseguir"
echo ""
read -p "Repositório já existe ou foi criado? (y/n): " REPO_EXISTS

if [ "$REPO_EXISTS" != "y" ]; then
    echo ""
    echo "💡 Crie o repositório no GitHub primeiro:"
    echo "   https://github.com/new"
    echo ""
    echo "Depois execute novamente:"
    echo "   ./setup_github_simple.sh"
    exit 0
fi

echo ""
echo "📤 Fazendo push para GitHub..."
git push -u origin main || {
    echo ""
    echo "⚠️  Erro ao fazer push. Possíveis causas:"
    echo ""
    echo "1. Repositório não existe no GitHub"
    echo "   → Crie em: https://github.com/new"
    echo ""
    echo "2. Sem permissão de acesso"
    echo "   → Configure: git config --global credential.helper osxkeychain"
    echo "   → Ou use SSH: git remote set-url origin git@github.com:$GITHUB_USER/$REPO_NAME.git"
    echo ""
    echo "3. Credenciais incorretas"
    echo "   → GitHub agora usa Personal Access Token"
    echo "   → Crie um token: https://github.com/settings/tokens"
    echo "   → Use o token como senha ao fazer push"
    echo ""
    exit 1
}

echo "✅ Push concluído!"
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    ✅ REPOSITÓRIO CRIADO!                     ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "🎉 Repositório disponível em:"
echo "   https://github.com/$GITHUB_USER/$REPO_NAME"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 PRÓXIMOS PASSOS OBRIGATÓRIOS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1️⃣  Configurar Secrets do GitHub (para GitHub Actions):"
echo ""
echo "   • Acesse: https://github.com/$GITHUB_USER/$REPO_NAME/settings/secrets/actions"
echo ""
echo "   • Clique em 'New repository secret'"
echo ""
echo "   • Adicione o primeiro secret:"
echo "     Nome:  SPRINTA_EMAIL"
echo "     Valor: seu-email@empresa.com"
echo ""
echo "   • Clique em 'New repository secret' novamente"
echo ""
echo "   • Adicione o segundo secret:"
echo "     Nome:  SPRINTA_PASSWORD"
echo "     Valor: sua-senha-sprinta"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  Testar GitHub Action:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "   • Acesse: https://github.com/$GITHUB_USER/$REPO_NAME/actions"
echo "   • Clique em 'Processar Inscrições Sprinta'"
echo "   • Clique em 'Run workflow'"
echo "   • Cole o CSV de exemplo:"
echo ""
echo "     name;email;phone;cpf;bday;gender;shirt_size;team"
echo "     João Silva;joao@example.com;51999990000;02443423000;01/01/1985;m;G;Equipe Alpha"
echo ""
echo "   • Clique em 'Run workflow'"
echo "   • Aguarde o processamento (~8s por participante)"
echo "   • Baixe resultados em 'Artifacts' → 'checkout-urls'"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  (Opcional) Configurar API:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "   • Crie GitHub Token: https://github.com/settings/tokens/new"
echo "   • Selecione escopos: repo + workflow"
echo "   • Configure .env:"
echo "     cp .env.example .env"
echo "     nano .env  # Adicione seu token"
echo "   • Teste: python trigger_github_action.py participants.csv"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📚 Documentação:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "   • Guia rápido (5 min): QUICKSTART.md"
echo "   • Documentação completa: README.md"
echo "   • Integração externa: API_USAGE.md"
echo ""
echo "🔗 Atalhos úteis:"
echo "   • Repositório: https://github.com/$GITHUB_USER/$REPO_NAME"
echo "   • Actions: https://github.com/$GITHUB_USER/$REPO_NAME/actions"
echo "   • Settings: https://github.com/$GITHUB_USER/$REPO_NAME/settings"
echo "   • Secrets: https://github.com/$GITHUB_USER/$REPO_NAME/settings/secrets/actions"
echo ""
echo "✅ Setup concluído com sucesso! 🎉"
