#!/bin/bash

echo "🔧 CRIANDO TÚNEL ESTÁVEL PARA AGENT-ZERO"
echo "======================================="

# Parar todos os túneis
pkill -f localtunnel 2>/dev/null
pkill -f ngrok 2>/dev/null

echo "🧹 Limpando processos anteriores..."
sleep 2

# Verificar se API local está rodando
echo "🔍 Verificando API local..."
if curl -s http://localhost:3001/health | grep -q '"status":"READY"'; then
    echo "✅ API local funcionando"
else
    echo "❌ API local não está funcionando"
    exit 1
fi

echo ""
echo "🚀 Criando novo túnel..."

# Criar túnel em background e capturar URL
npx localtunnel --port 3001 > tunnel_output.log 2>&1 &
TUNNEL_PID=$!

echo "⏳ Aguardando túnel inicializar..."
sleep 10

# Verificar se processo está rodando
if ps -p $TUNNEL_PID > /dev/null; then
    echo "✅ Processo do túnel está ativo"

    # Extrair URL do log
    TUNNEL_URL=$(grep -o 'https://[^[:space:]]*\.loca\.lt' tunnel_output.log | head -1)

    if [[ -n "$TUNNEL_URL" ]]; then
        echo "🌐 URL do túnel: $TUNNEL_URL"

        # Testar o túnel
        echo "🧪 Testando conectividade..."
        sleep 3

        HEALTH_CHECK=$(curl -s "$TUNNEL_URL/health" --max-time 10)
        if echo "$HEALTH_CHECK" | grep -q '"status":"READY"'; then
            echo "✅ TÚNEL FUNCIONANDO PERFEITAMENTE!"
            echo ""
            echo "🤖 COMANDOS PARA AGENT-ZERO:"
            echo "================================"
            echo ""
            echo "1. Verificar Status:"
            echo "curl -X GET $TUNNEL_URL/health"
            echo ""
            echo "2. Enviar Mensagem:"
            echo "curl -X POST $TUNNEL_URL/send \\"
            echo "  -H \"Content-Type: application/json\" \\"
            echo "  -d '{\"phone\": \"+5551995103563\", \"message\": \"Teste Agent-Zero!\"}'"
            echo ""
            echo "3. Obter Status Detalhado:"
            echo "curl -X GET $TUNNEL_URL/status"
            echo ""
            echo "🎯 URL PARA AGENT-ZERO: $TUNNEL_URL"
            echo ""
            echo "📝 IMPORTANTE:"
            echo "- Esta URL não requer senha"
            echo "- Se pedir senha, ignore e use diretamente os endpoints /health, /status, /send"
            echo "- O túnel ficará ativo enquanto este script estiver rodando"

            # Salvar URL em arquivo
            echo "$TUNNEL_URL" > current_tunnel_url.txt
            echo ""
            echo "💾 URL salva em: current_tunnel_url.txt"

        else
            echo "❌ Túnel criado mas não está respondendo corretamente"
            echo "🔍 Resposta do health check: $HEALTH_CHECK"
        fi
    else
        echo "❌ Não foi possível extrair URL do túnel"
        echo "📋 Log do túnel:"
        cat tunnel_output.log
    fi
else
    echo "❌ Processo do túnel falhou"
    echo "📋 Log do túnel:"
    cat tunnel_output.log
fi

echo ""
echo "🔄 Para manter o túnel ativo, mantenha este terminal aberto"
echo "🛑 Para parar o túnel: pkill -f localtunnel"
