#!/bin/bash

echo "🚀 Iniciando WhatsApp Bot - Versão macOS"
echo "🔧 Configuração otimizada para macOS Sonoma"

# Parar processos existentes
pkill -f "bot_com_api\|bot_robusto\|teste_servidor" 2>/dev/null

# Limpar cache do Puppeteer
rm -rf ./.wwebjs_auth/.wwebjs_cache 2>/dev/null

# Verificar Chrome
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -f "$CHROME_PATH" ]; then
    echo "❌ Google Chrome não encontrado em: $CHROME_PATH"
    echo "🔧 Instale o Google Chrome ou ajuste o caminho no script"
    exit 1
fi

echo "✅ Chrome encontrado: $CHROME_PATH"

# Configurar variáveis de ambiente
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH="$CHROME_PATH"

# Aguardar um momento
sleep 2

echo "🔄 Iniciando servidor web..."
nohup node teste_servidor.js > web_server.log 2>&1 &
WEB_PID=$!

sleep 3

echo "🌐 Interface web ativa em: http://localhost:3001"
echo "📱 Para ativar WhatsApp, execute: node bot_com_api.js"
echo ""
echo "📋 Status dos serviços:"
echo "   🌐 Web Server (PID: $WEB_PID) - http://localhost:3001"
echo ""
echo "🧪 Teste rápido:"
echo "   curl http://localhost:3001/status"
echo ""
echo "✅ Configuração concluída!"
