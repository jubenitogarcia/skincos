#!/bin/bash
set -e

echo "🔧 Configurando ambiente..."

# Corrigir problemas do dpkg primeiro
dpkg --configure -a 2>/dev/null || true

# Atualizar repositórios
apt-get update

# Instalar dependências básicas
echo "📦 Instalando dependências básicas..."
apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    libgconf-2-4 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libcairo-gobject2 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrender1 \
    libxtst6 \
    libcups2 \
    libdrm2 \
    xvfb \
    fonts-liberation \
    libnss3 \
    lsb-release

# Adicionar repositório do Google Chrome
echo "🌐 Adicionando repositório do Chrome..."
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -
echo 'deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/google-chrome.list

# Atualizar repositórios novamente
apt-get update

# Instalar Google Chrome
echo "🔍 Instalando Google Chrome..."
apt-get install -y google-chrome-stable

# Verificar se o Chrome foi instalado
if [ ! -f "/usr/bin/google-chrome-stable" ]; then
    echo "❌ Chrome não foi instalado corretamente!"
    exit 1
fi

echo "✅ Chrome instalado com sucesso!"

# Instalar dependências Node.js
echo "📦 Instalando dependências NPM..."
cd /app
npm install

# Configurar X11
echo "🖥️ Configurando X11..."
export DISPLAY=:99
export DEBIAN_FRONTEND=noninteractive

# Iniciar Xvfb
echo "🎯 Iniciando Xvfb..."
nohup Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset > /dev/null 2>&1 &

# Aguardar Xvfb estar pronto
sleep 5

echo "🚀 Iniciando aplicação..."
echo "📱 WhatsApp Bot API será executado..."

# Verificar se o arquivo existe
if [ ! -f "/app/bot_com_api.js" ]; then
    echo "❌ Arquivo bot_com_api.js não encontrado!"
    exit 1
fi

# Limpar processos Chrome antigos
echo "🧹 Limpando processos Chrome antigos..."
pkill -f chrome || true
pkill -f google-chrome || true
sleep 2

# Definir variáveis de ambiente para Chrome
export CHROME_BIN=/usr/bin/google-chrome-stable
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Verificar se Chrome está funcionando
echo "🔍 Verificando Chrome..."
if ! /usr/bin/google-chrome-stable --version; then
    echo "❌ Chrome não está funcionando corretamente"
    exit 1
fi

echo "🔄 Inicializando WhatsApp Client..."

# Executar a aplicação
exec node bot_com_api.js
