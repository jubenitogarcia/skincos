#!/bin/bash

echo "🚀 SOLUÇÕES PARA AGENT-ZERO ACESSAR WHATSAPP API"
echo "==============================================="

echo ""
echo "PROBLEMA IDENTIFICADO:"
echo "Agent-Zero está em ambiente isolado (Docker/VM) e não consegue acessar localhost:3001"
echo ""

echo "📋 SOLUÇÕES POSSÍVEIS:"
echo ""

echo "1. 🌐 TÚNEL PÚBLICO (Recomendado)"
echo "   Usar serviço como ngrok ou CloudFlare Tunnel"
echo ""

echo "2. 🔗 CONFIGURAÇÃO DE REDE DOCKER"
echo "   Se Agent-Zero está em Docker, usar --network=host"
echo ""

echo "3. 🖥️ IP DO HOST DOCKER"
echo "   Agent-Zero pode usar host.docker.internal:3001"
echo ""

echo "4. 📱 API EXTERNA"
echo "   Usar serviço na nuvem (Heroku, Railway, etc.)"
echo ""

echo "🧪 TESTANDO SOLUÇÕES..."
echo ""

# Testar se é Docker
echo "1. 🐳 Verificando se Agent-Zero está em Docker..."
if docker ps | grep -q agent; then
    echo "   ✅ Containers Agent encontrados"
    echo "   💡 Agent-Zero deve usar: http://host.docker.internal:3001"
else
    echo "   ❌ Nenhum container Agent encontrado"
fi

echo ""
echo "2. 🌐 Tentando criar túnel simples..."

# Verificar se podemos usar npx localtunnel
if command -v npx >/dev/null 2>&1; then
    echo "   🔄 Instalando LocalTunnel temporariamente..."
    npx localtunnel --port 3001 --print-requests > tunnel.log 2>&1 &
    TUNNEL_PID=$!

    sleep 5

    if ps -p $TUNNEL_PID > /dev/null; then
        TUNNEL_URL=$(grep -o 'https://.*\.loca\.lt' tunnel.log | head -1)
        if [[ -n "$TUNNEL_URL" ]]; then
            echo "   ✅ Túnel criado: $TUNNEL_URL"
            echo ""
            echo "🎯 COMANDO PARA AGENT-ZERO TESTAR:"
            echo "curl -X GET $TUNNEL_URL/health"
            echo ""
            echo "🎯 COMANDO PARA ENVIAR MENSAGEM:"
            echo "curl -X POST $TUNNEL_URL/send \\"
            echo "  -H \"Content-Type: application/json\" \\"
            echo "  -d '{\"phone\": \"+5551995103563\", \"message\": \"Teste Agent-Zero via túnel!\"}'"

            # Testar o túnel
            echo ""
            echo "🧪 Testando túnel..."
            TUNNEL_TEST=$(curl -s "$TUNNEL_URL/health" | grep -o '"status":"READY"')
            if [[ -n "$TUNNEL_TEST" ]]; then
                echo "   ✅ Túnel funcionando! Agent-Zero pode usar: $TUNNEL_URL"
            else
                echo "   ⚠️ Túnel pode precisar de alguns segundos para ativar"
            fi
        else
            echo "   ❌ Erro ao obter URL do túnel"
            kill $TUNNEL_PID
        fi
    else
        echo "   ❌ Erro ao iniciar túnel"
    fi
else
    echo "   ❌ npx não disponível"
fi

echo ""
echo "3. 🔧 Outras opções:"
echo "   - Instalar ngrok manualmente: https://ngrok.com/download"
echo "   - Usar CloudFlare Tunnel: cloudflared tunnel"
echo "   - Configurar Agent-Zero para usar host.docker.internal:3001"
echo ""

echo "📝 PRÓXIMOS PASSOS:"
echo "1. Se túnel funcionou, passe a URL para Agent-Zero"
echo "2. Se não funcionou, verificar configuração de rede do Agent-Zero"
echo "3. Considerar deploy em nuvem para acesso permanente"
