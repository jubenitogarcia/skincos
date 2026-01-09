#!/bin/bash

echo "🌐 EXPOSIÇÃO GLOBAL DA WHATSAPP API"
echo "=================================="

echo ""
echo "Escolha como quer expor sua API para acesso global:"
echo ""

echo "🆓 OPÇÕES GRATUITAS:"
echo "1. CloudFlare Tunnel (Recomendado - Grátis para sempre)"
echo "2. Ngrok Free (2h por sessão, 1 túnel)"
echo "3. LocalTunnel (Instável, pode pedir senha)"
echo ""

echo "💰 OPÇÕES PAGAS:"
echo "4. Ngrok Pro ($8/mês - Muito confiável)"
echo "5. Railway Deploy ($5/mês - Produção)"
echo "6. Fly.io Deploy ($1.94/mês - Rápido)"
echo ""

echo "🔧 OPÇÃO PARA DOCKER:"
echo "7. Configurar host.docker.internal (Agent-Zero local)"
echo ""

read -p "Digite sua escolha (1-7): " choice

case $choice in
    1)
        echo ""
        echo "🌩️ CONFIGURANDO CLOUDFLARE TUNNEL..."
        chmod +x setup_cloudflare_tunnel.sh
        ./setup_cloudflare_tunnel.sh
        ;;
    2)
        echo ""
        echo "🚀 CONFIGURANDO NGROK FREE..."
        chmod +x setup_ngrok.sh
        ./setup_ngrok.sh
        ;;
    3)
        echo ""
        echo "📡 CONFIGURANDO LOCALTUNNEL..."
        echo "⚠️ AVISO: Pode ser instável e pedir senha"
        npx localtunnel --port 3001 &
        sleep 5
        echo "Verifique a URL que apareceu acima"
        ;;
    4)
        echo ""
        echo "💎 CONFIGURANDO NGROK PRO..."
        chmod +x setup_ngrok.sh
        ./setup_ngrok.sh
        echo ""
        echo "💡 Para Pro: Faça upgrade em https://ngrok.com/pricing"
        ;;
    5)
        echo ""
        echo "☁️ PREPARANDO DEPLOY RAILWAY..."
        chmod +x setup_railway_deploy.sh
        ./setup_railway_deploy.sh
        ;;
    6)
        echo ""
        echo "🚁 FLY.IO DEPLOY:"
        echo "1. Instale: brew install flyctl"
        echo "2. Cadastre: fly auth signup"
        echo "3. Deploy: fly launch"
        echo "Documentação: https://fly.io/docs/"
        ;;
    7)
        echo ""
        echo "🐳 CONFIGURAÇÃO DOCKER LOCAL:"
        echo ""
        echo "Para Agent-Zero em Docker na mesma máquina:"
        echo "URL: http://host.docker.internal:3001"
        echo ""
        echo "🧪 TESTE:"
        echo "curl -X GET http://host.docker.internal:3001/health"
        echo ""

        # Verificar se API está acessível
        if curl -s http://localhost:3001/health | grep -q '"status":"READY"'; then
            echo "✅ API local funcionando"
            echo "🤖 Agent-Zero pode usar: http://host.docker.internal:3001"
        else
            echo "❌ API local não está rodando"
        fi
        ;;
    *)
        echo "❌ Opção inválida"
        exit 1
        ;;
esac

echo ""
echo "📋 RESUMO DAS OPÇÕES:"
echo ""
echo "🥇 MELHOR GRATUITA: CloudFlare Tunnel (opção 1)"
echo "🥇 MELHOR PAGA: Railway (opção 5) ou Ngrok Pro (opção 4)"
echo "🥇 PARA DOCKER LOCAL: host.docker.internal (opção 7)"
echo ""
echo "🎯 TODAS expõem sua API para acesso global!"
echo "Agent-Zero poderá conectar de qualquer lugar do mundo."
