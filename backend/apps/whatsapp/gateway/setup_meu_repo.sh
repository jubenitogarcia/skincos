#!/bin/bash

echo "🚀 CONFIGURANDO SEU REPOSITÓRIO WHATSAPP AUTOMATION"
echo "=================================================="

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# Detectar usuário do GitHub do git config
GITHUB_USER=$(git config user.name | tr '[:upper:]' '[:lower:]' | sed 's/ //g')
if [ -z "$GITHUB_USER" ]; then
    echo -e "${RED}❌ Não foi possível detectar seu usuário do GitHub.${NC}"
    echo -e "${YELLOW}💡 Configure com: git config --global user.name 'SeuUsuario'${NC}"
    echo -e "${BLUE}📋 Digite seu usuário do GitHub:${NC}"
    read -p "Usuário: " GITHUB_USER
fi

REPO_NAME="whatsapp-automation-enterprise"

echo -e "${BLUE}📋 Configurações:${NC}"
echo -e "   👤 Usuário: $GITHUB_USER"
echo -e "   📁 Repositório: $REPO_NAME"
echo ""

# Confirmar com usuário
echo -e "${YELLOW}⚠️  Confirma as configurações acima? (y/n):${NC}"
read -p "Confirmar: " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo -e "${RED}❌ Operação cancelada pelo usuário.${NC}"
    exit 1
fi

# 1. Verificar se há modificações não commitadas
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}💾 Salvando todas as modificações...${NC}"
    git add .
    git commit -m "feat: Implementação completa WhatsApp Automation Enterprise

- 30+ endpoints funcionais implementados
- Funcionalidades avançadas: reações, edição, encaminhamento
- Estados de presença: digitando, gravando, online/offline
- Gestão completa: arquivamento, pinning, favoritos
- Analytics: versão WhatsApp, bateria, broadcasts
- Documentação completa para Agent-Zero
- Testes automatizados validados
- Compatibilidade 100% com Agent-Zero confirmada
- Sistema pronto para uso empresarial"

    echo -e "${GREEN}✅ Commit criado com sucesso!${NC}"
else
    echo -e "${BLUE}📋 Não há modificações pendentes.${NC}"
fi

# 2. Verificar status atual
echo -e "${BLUE}📊 Status atual do repositório:${NC}"
echo -e "   Último commit: $(git log --oneline -n 1)"
echo -e "   Remotes atuais:"
git remote -v
echo ""

# 3. Backup da configuração atual
echo -e "${YELLOW}💾 Fazendo backup da configuração atual...${NC}"
git remote -v > .git_remotes_backup.txt
echo -e "${GREEN}✅ Backup salvo em .git_remotes_backup.txt${NC}"

# 4. Remover origin atual
echo -e "${YELLOW}🔧 Removendo conexão com repositório original...${NC}"
if git remote get-url origin > /dev/null 2>&1; then
    git remote remove origin
    echo -e "${GREEN}✅ Origin removido.${NC}"
else
    echo -e "${BLUE}📋 Nenhum origin configurado.${NC}"
fi

# 5. Adicionar novo origin
echo -e "${YELLOW}🔗 Conectando ao seu repositório...${NC}"
NEW_ORIGIN="https://github.com/$GITHUB_USER/$REPO_NAME.git"
git remote add origin $NEW_ORIGIN

echo -e "${GREEN}✅ Novo origin configurado: $NEW_ORIGIN${NC}"

# 6. Verificar nova configuração
echo -e "${BLUE}📋 Nova configuração:${NC}"
git remote -v
echo ""

# 7. Criar branch main se não existir
if ! git show-ref --verify --quiet refs/heads/main; then
    echo -e "${YELLOW}🔧 Criando branch main...${NC}"
    git checkout -b main
fi

# 8. Instruções finais
echo ""
echo -e "${GREEN}🎉 CONFIGURAÇÃO LOCAL CONCLUÍDA!${NC}"
echo ""
echo -e "${YELLOW}📋 PRÓXIMOS PASSOS OBRIGATÓRIOS:${NC}"
echo ""
echo -e "${BLUE}1. Criar repositório no GitHub:${NC}"
echo -e "   🔗 Acesse: https://github.com/new"
echo -e "   📁 Repository name: ${REPO_NAME}"
echo -e "   📝 Description: Sistema completo de automação WhatsApp com 30+ funcionalidades avançadas para Agent-Zero"
echo -e "   🔓 Escolha: Public ou Private"
echo -e "   ❌ NÃO marque: Add a README file"
echo -e "   ❌ NÃO marque: Add .gitignore"
echo -e "   ❌ NÃO marque: Choose a license"
echo -e "   ✅ Clique: Create repository"
echo ""
echo -e "${BLUE}2. Fazer push inicial:${NC}"
echo -e "   ${GREEN}git push -u origin main${NC}"
echo ""
echo -e "${BLUE}3. Verificar sucesso:${NC}"
echo -e "   🔗 https://github.com/$GITHUB_USER/$REPO_NAME"
echo ""
echo -e "${BLUE}4. Comandos úteis:${NC}"
echo -e "   📊 Status: git status"
echo -e "   📋 Log: git log --oneline -n 5"
echo -e "   🔗 Remotes: git remote -v"
echo ""
echo -e "${GREEN}🚀 Seu projeto estará disponível em:${NC}"
echo -e "${BLUE}https://github.com/$GITHUB_USER/$REPO_NAME${NC}"
echo ""
echo -e "${YELLOW}💡 Após criar o repositório no GitHub, execute:${NC}"
echo -e "${GREEN}git push -u origin main${NC}"
