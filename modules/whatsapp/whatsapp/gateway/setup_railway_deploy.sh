#!/bin/bash

echo "☁️ DEPLOY EM NUVEM - RAILWAY (RECOMENDADO)"
echo "========================================="

echo ""
echo "💎 MELHOR OPÇÃO PARA PRODUÇÃO"
echo "- 💰 $5/mês básico"
echo "- ✅ Deploy automático via Git"
echo "- ✅ Domínio HTTPS gratuito"
echo "- ✅ 99.9% uptime"
echo "- ✅ Escalabilidade automática"
echo "- ✅ Logs e monitoring"
echo ""

echo "🔧 PREPARAÇÃO PARA DEPLOY:"
echo ""

# Verificar se está no diretório correto
if [ ! -f "bot_estavel_macos.js" ]; then
    echo "❌ Execute este script no diretório do WhatsApp bot"
    exit 1
fi

echo "1. 📦 Criando package.json para produção..."

# Criar package.json otimizado para Railway
cat > package.json << 'EOF'
{
  "name": "whatsapp-api-bot",
  "version": "1.0.0",
  "description": "WhatsApp Bot API for Agent-Zero integration",
  "main": "bot_estavel_macos.js",
  "scripts": {
    "start": "node bot_estavel_macos.js",
    "dev": "node bot_estavel_macos.js"
  },
  "dependencies": {
    "whatsapp-web.js": "^1.31.1-alpha.0",
    "qrcode-terminal": "^0.12.0",
    "express": "^4.18.2",
    "cors": "^2.8.5"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "keywords": ["whatsapp", "api", "bot", "agent-zero"],
  "author": "Seu Nome",
  "license": "MIT"
}
EOF

echo "✅ package.json criado"

echo ""
echo "2. 🐳 Criando Dockerfile..."

# Criar Dockerfile otimizado
cat > Dockerfile << 'EOF'
FROM node:18-slim

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    libgconf-2-4 \
    libxtst6 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libcairo-gobject2 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Instalar Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package.json e instalar dependências
COPY package.json ./
RUN npm install --production

# Copiar código da aplicação
COPY . .

# Expor porta
EXPOSE 3001

# Comando para iniciar
CMD ["npm", "start"]
EOF

echo "✅ Dockerfile criado"

echo ""
echo "3. 🚫 Criando .dockerignore..."

cat > .dockerignore << 'EOF'
node_modules
npm-debug.log
.git
.gitignore
README.md
.env
.nyc_output
coverage
.DS_Store
*.log
.wwebjs_auth
.wwebjs_cache
EOF

echo "✅ .dockerignore criado"

echo ""
echo "4. 🔧 Adaptando bot para produção..."

# Verificar se o bot precisa ser adaptado
if grep -q "executablePath.*Chrome" bot_estavel_macos.js; then
    echo "⚠️ Bot precisa ser adaptado para Linux/Docker"
    echo "Criando versão para produção..."

    # Criar versão adaptada para produção
    sed 's/\/Applications\/Google Chrome\.app\/Contents\/MacOS\/Google Chrome/\/usr\/bin\/google-chrome-stable/g' bot_estavel_macos.js > bot_production.js

    # Atualizar package.json para usar versão de produção
    sed -i '' 's/"main": "bot_estavel_macos.js"/"main": "bot_production.js"/' package.json
    sed -i '' 's/"start": "node bot_estavel_macos.js"/"start": "node bot_production.js"/' package.json

    echo "✅ bot_production.js criado"
fi

echo ""
echo "🚀 PRÓXIMOS PASSOS PARA RAILWAY:"
echo ""
echo "1. 📝 Acesse: https://railway.app/"
echo "2. 🔗 Conecte com GitHub"
echo "3. ➕ Create New Project > Deploy from GitHub repo"
echo "4. 🔍 Selecione este repositório"
echo "5. ⚙️ Railway detectará automaticamente o Dockerfile"
echo "6. 🚀 Deploy automático começará"
echo ""

echo "💡 APÓS DEPLOY:"
echo "Sua API estará em: https://whatsapp-api-production.up.railway.app"
echo ""
echo "🤖 Agent-Zero usará:"
echo "curl -X GET https://whatsapp-api-production.up.railway.app/health"
echo ""

echo "📋 ARQUIVOS CRIADOS:"
echo "- ✅ package.json"
echo "- ✅ Dockerfile"
echo "- ✅ .dockerignore"
echo "- ✅ bot_production.js (se necessário)"
echo ""

echo "🎯 CUSTO ESTIMADO RAILWAY:"
echo "- 💰 $5/mês para uso básico"
echo "- 🆓 $5 grátis no primeiro mês"
echo "- 📊 Uso baseado em recursos consumidos"
