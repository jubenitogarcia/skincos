#!/usr/bin/env bash
# Gerenciador LOCAL (sem Docker) de múltiplas instâncias do gateway WhatsApp
# Reservando PORTAS 3001..3009 exclusivamente para instâncias WhatsApp.
# Uso: ./manage-instances.sh <comando> <1-9|all>
# Comandos: start | stop | restart | status | logs | tail | install | clean

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

show_usage() {
    cat <<EOF
${BLUE}Uso:${NC} $0 <comando> [instância]

Comandos (modo local apenas):
    start      Inicia instância (1,2 ou all)
    stop       Para instância (1,2 ou all)
    restart    Reinicia instância
    status     Mostra status (porta, PID, pronto, QR)
    logs       Tail -f dos logs (alias tail)
    tail       Igual a logs
    install    Executa npm install se necessário
    clean      Remove diretórios de sessão e PIDs

Instâncias (reservadas 3001..3009):
    1..9       Porta 300N  auth: .wwebjs_auth_local_N  log: local_N.out
    all        Inicia ou para todas (1..9)

Exemplos:
    $0 start 1
    $0 start all
    $0 status
    $0 logs 2
    $0 restart 2
EOF
}

pid_file() { echo ".local_instance_${1}.pid"; }
auth_path() { echo ".wwebjs_auth_local_${1}"; }
port_for() { local inst=$1; echo $((3000 + inst)); }
port_file() { echo ".local_instance_${1}.port"; } # mantido por compatibilidade (sempre igual ao reservado)

ensure_node() {
    command -v node >/dev/null 2>&1 || { echo -e "${RED}❌ Node.js não encontrado no PATH${NC}"; exit 1; }
}

ensure_install() {
    if [ ! -f package.json ]; then echo -e "${RED}❌ Executar dentro de whatsapp-gateway${NC}"; exit 1; fi
    if [ ! -d node_modules ]; then
        echo -e "${YELLOW}📦 Instalando dependências...${NC}"; npm install --no-audit --no-fund >/dev/null 2>&1 || npm install
    fi
}

start_one() {
    local inst=$1
    if ! [[ $inst =~ ^[1-9]$ ]]; then echo -e "${RED}Instância inválida: $inst (use 1-9)${NC}"; return 1; fi
    local port=$(port_for $inst)
    local pidf=$(pid_file $inst)
    local auth=$(auth_path $inst)
    local portf=$(port_file $inst)
    if [ -f "$pidf" ] && kill -0 $(cat "$pidf") 2>/dev/null; then
        echo -e "${YELLOW}⚠️ Instância $inst já ativa (PID $(cat $pidf))${NC}"; return 0; fi
    if lsof -i :$port -sTCP:LISTEN >/dev/null 2>&1; then
        echo -e "${RED}❌ Porta reservada $port já está em uso por outro processo. Libere-a (kill) antes de iniciar a instância $inst.${NC}"; return 1; fi
    echo "$port" > "$portf"
    echo -e "${GREEN}🚀 Iniciando instância $inst na porta $port ...${NC}"
    PORT=$port ACCOUNT_ID="local$inst" WWJS_AUTH_PATH="$auth" nohup node bot_com_api.js --authPath "$auth" > "local_${inst}.out" 2>&1 &
    echo $! > "$pidf"
    echo -e "${GREEN}✅ PID $(cat $pidf). QR: http://localhost:$port/qr.html  Logs: tail -f local_${inst}.out${NC}"
}

stop_one() {
    local inst=$1; local pidf=$(pid_file $inst)
    if [ ! -f "$pidf" ]; then echo -e "${YELLOW}⚠️ Sem PID file para instância $inst${NC}"; return 0; fi
    local PID=$(cat "$pidf")
    if kill -0 $PID 2>/dev/null; then
        echo -e "${YELLOW}🛑 Parando instância $inst (PID $PID)${NC}"; kill $PID || true; sleep 1
        if kill -0 $PID 2>/dev/null; then echo -e "${RED}❌ Falhou encerrar PID $PID${NC}"; else echo -e "${GREEN}✅ Instância $inst parada${NC}"; fi
    else
        echo -e "${YELLOW}⚠️ PID $PID não ativo${NC}"
    fi
    rm -f "$pidf"
}

status_one() {
    local inst=$1; if ! [[ $inst =~ ^[1-9]$ ]]; then return; fi
    local pidf=$(pid_file $inst); local port=$(port_for $inst)
    local state="Parada"; local pid="-"; local ready="-"; local qr="http://localhost:$port/qr.html"
    if [ -f "$pidf" ] && kill -0 $(cat "$pidf") 2>/dev/null; then
        pid=$(cat "$pidf"); state="Ativa";
        local raw=$(curl -s --max-time 2 http://localhost:$port/status || true)
        if echo "$raw" | grep -q '"ready"'; then ready="Pronto"; fi
    fi
    printf "Instância %s | Porta %-5s | PID %-7s | %-6s | QR: %s\n" "$inst" "$port" "$pid" "$state" "$qr"
}

logs_one() {
    local inst=$1; local file="local_${inst}.out"; [ -f "$file" ] || { echo -e "${RED}Sem log $file${NC}"; return 1; }; tail -f "$file"
}

clean_all() {
    for i in {1..9}; do stop_one $i || true; rm -rf "$(auth_path $i)"; done
    rm -f .local_instance_*.pid .local_instance_*.port
    echo -e "${GREEN}🧹 Limpeza concluída (1..9)${NC}"
}

cmd=${1:-}
arg=${2:-}
if [ -z "$cmd" ]; then show_usage; exit 1; fi

cd "$(dirname "$0")" || exit 1
ensure_node
ensure_install

case "$cmd" in
    start)
        if [ -z "$arg" ]; then echo -e "${RED}Informe instância (1|2|all)${NC}"; exit 1; fi
    if [ "$arg" = "all" ]; then for i in {1..9}; do start_one $i; done; else start_one "$arg"; fi
        ;;
    stop)
        if [ -z "$arg" ]; then echo -e "${RED}Informe instância (1|2|all)${NC}"; exit 1; fi
    if [ "$arg" = "all" ]; then for i in {1..9}; do stop_one $i; done; else stop_one "$arg"; fi
        ;;
    restart)
        if [ -z "$arg" ]; then echo -e "${RED}Informe instância (1|2|all)${NC}"; exit 1; fi
    if [ "$arg" = "all" ]; then for i in {1..9}; do stop_one $i; done; for i in {1..9}; do start_one $i; done; else stop_one "$arg"; start_one "$arg"; fi
        ;;
    status)
        echo -e "${BLUE}📊 Status Local das Instâncias${NC}"
        echo "----------------------------------"
    for i in {1..9}; do status_one $i; done
        ;;
    logs|tail)
        if [ -z "$arg" ]; then echo -e "${RED}Informe instância (1|2)${NC}"; exit 1; fi
        logs_one "$arg"
        ;;
    install)
        echo -e "${GREEN}✅ Dependências prontas${NC}";
        ;;
    clean)
        clean_all
        ;;
    *)
        echo -e "${RED}Comando inválido${NC}"; show_usage; exit 1;;
esac
