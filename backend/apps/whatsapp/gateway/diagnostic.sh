#!/bin/bash

echo "🔍 Diagnóstico Completo do Ambiente Docker"
echo "=========================================="
echo

echo "1️⃣ Informações do Sistema:"
echo "OS: $(cat /etc/os-release | grep PRETTY_NAME | cut -d'=' -f2 | tr -d '\"')"
echo "Kernel: $(uname -r)"
echo "Arquitetura: $(uname -m)"
echo

echo "2️⃣ Informações do Chrome:"
if [ -f "/usr/bin/google-chrome-stable" ]; then
    echo "✅ Chrome encontrado: $(/usr/bin/google-chrome-stable --version)"
    echo "📂 Localização: /usr/bin/google-chrome-stable"
    echo "🔒 Permissões: $(ls -la /usr/bin/google-chrome-stable)"
else
    echo "❌ Chrome NÃO encontrado em /usr/bin/google-chrome-stable"
fi
echo

echo "3️⃣ Informações do Display:"
echo "DISPLAY: $DISPLAY"
echo "Processos Xvfb: $(ps aux | grep Xvfb | grep -v grep || echo 'Nenhum')"
echo

echo "4️⃣ Permissões de Diretórios:"
echo "📂 /tmp/chrome-user-data:"
if [ -d "/tmp/chrome-user-data" ]; then
    echo "   Existe: ✅"
    echo "   Permissões: $(ls -ld /tmp/chrome-user-data)"
    echo "   Proprietário: $(stat -c '%U:%G' /tmp/chrome-user-data)"
else
    echo "   Não existe: ❌"
fi
echo

echo "📂 /app:"
echo "   Permissões: $(ls -ld /app)"
echo "   Proprietário: $(stat -c '%U:%G' /app)"
echo

echo "5️⃣ Memória e Recursos:"
echo "Memória total: $(free -h | grep Mem | awk '{print $2}')"
echo "Memória disponível: $(free -h | grep Mem | awk '{print $7}')"
echo "Espaço em /tmp: $(df -h /tmp | tail -1 | awk '{print $4}')"
echo

echo "6️⃣ Variáveis de Ambiente Relevantes:"
echo "NODE_ENV: $NODE_ENV"
echo "PUPPETEER_EXECUTABLE_PATH: $PUPPETEER_EXECUTABLE_PATH"
echo "CHROME_DEVEL_SANDBOX: $CHROME_DEVEL_SANDBOX"
echo

echo "7️⃣ Teste Rápido do Chrome:"
echo "Tentando executar Chrome com --version..."
if /usr/bin/google-chrome-stable --version &>/dev/null; then
    echo "✅ Chrome responde ao comando --version"
else
    echo "❌ Chrome NÃO responde ao comando --version"
fi

echo
echo "8️⃣ Teste de Escrita em /tmp:"
TEST_FILE="/tmp/test_write_$(date +%s)"
if touch "$TEST_FILE" 2>/dev/null; then
    echo "✅ Pode escrever em /tmp"
    rm -f "$TEST_FILE"
else
    echo "❌ NÃO pode escrever em /tmp"
fi

echo
echo "Diagnóstico concluído!"
