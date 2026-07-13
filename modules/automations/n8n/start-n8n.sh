#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# shellcheck disable=SC1091
if [ -f "$SCRIPT_DIR/scripts/lib/runtime-paths.sh" ]; then
    source "$SCRIPT_DIR/scripts/lib/runtime-paths.sh"
fi

MANAGE_EVOLUTION="${N8N_MANAGE_EVOLUTION:-1}"
MANAGE_ORB_PROXY="${N8N_MANAGE_ORB_PROXY:-1}"
LOCAL_STATE_ROOT="${N8N_LOCAL_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/skincos/n8n}"
LOCAL_PID_DIR="${N8N_LOCAL_PID_DIR:-$LOCAL_STATE_ROOT/pids}"
LOCAL_LOG_DIR="${N8N_LOCAL_LOG_DIR:-$LOCAL_STATE_ROOT/logs}"
LOCAL_TMP_DIR="${N8N_LOCAL_TMP_DIR:-$LOCAL_STATE_ROOT/tmp}"
LOCAL_BINARY_DATA_DIR="${N8N_LOCAL_BINARY_DATA_DIR:-$LOCAL_STATE_ROOT/binary-data}"
ORB_PROXY_PID_FILE="${ORB_PROXY_PID_FILE:-$LOCAL_PID_DIR/orb-proxy.pid}"
ORB_PROXY_LOG_FILE="${ORB_PROXY_LOG_FILE:-$LOCAL_LOG_DIR/orb-proxy.log}"
EVO_PID_FILE="${EVO_PID_FILE:-$LOCAL_PID_DIR/evolution-api.pid}"
EVO_LOG_FILE="${EVO_LOG_FILE:-$LOCAL_LOG_DIR/evolution-api.log}"
N8N_LOCAL_RUNTIME_NOTE="${N8N_LOCAL_RUNTIME_NOTE:-1}"

should_manage_evolution() {
    [ "$MANAGE_EVOLUTION" = "1" ]
}

should_manage_orb_proxy() {
    [ "$MANAGE_ORB_PROXY" = "1" ]
}

prepare_local_runtime_state() {
    mkdir -p "$LOCAL_STATE_ROOT" "$LOCAL_PID_DIR" "$LOCAL_LOG_DIR" "$LOCAL_TMP_DIR" "$LOCAL_BINARY_DATA_DIR"

    export N8N_STORAGE_PATH="${N8N_STORAGE_PATH:-$LOCAL_BINARY_DATA_DIR}"
    export N8N_RESTRICT_FILE_ACCESS_TO="${N8N_RESTRICT_FILE_ACCESS_TO:-$LOCAL_TMP_DIR}"
    export META_REVIEW_STORE_PATH="${META_REVIEW_STORE_PATH:-$LOCAL_TMP_DIR/meta-review-store.json}"

    if [ "$N8N_LOCAL_RUNTIME_NOTE" = "1" ]; then
        echo "ℹ️  start-n8n.sh executa apenas um launcher local/manual."
        echo "ℹ️  Para o runtime compartilhado do mini-PC, use os comandos service:* e os serviços skincos-*."
        echo "ℹ️  Estado local privado: $LOCAL_STATE_ROOT"
    fi
}

ensure_required_builtin_allowlist() {
    local current merged

    current="$(printf '%s' "${NODE_FUNCTION_ALLOW_BUILTIN:-}" | tr -d '[:space:]')"

    if [ "$current" = "*" ]; then
        export NODE_FUNCTION_ALLOW_BUILTIN="*"
        return 0
    fi

    if [ -z "$current" ]; then
        export NODE_FUNCTION_ALLOW_BUILTIN="fs,child_process"
        return 0
    fi

    merged="$current"
    case ",$merged," in
        *,fs,*) ;;
        *) merged="${merged},fs" ;;
    esac
    case ",$merged," in
        *,child_process,*) ;;
        *) merged="${merged},child_process" ;;
    esac

    export NODE_FUNCTION_ALLOW_BUILTIN="$merged"
}

kill_with_timeout() {
    local pids="$1"
    local timeout="${2:-5}"
    if [ -z "$pids" ]; then
        return 0
    fi
    kill $pids 2>/dev/null || true
    local waited=0
    while [ "$waited" -lt "$timeout" ]; do
        sleep 1
        waited=$((waited + 1))
        local still_running=""
        for pid in $pids; do
            if kill -0 "$pid" >/dev/null 2>&1; then
                still_running="$still_running $pid"
            fi
        done
        if [ -z "$still_running" ]; then
            return 0
        fi
        pids="$still_running"
    done
    kill -9 $pids 2>/dev/null || true
}

wait_for_http() {
    local url="$1"
    local timeout="${2:-30}"
    local waited=0
    local curl_opts="-fsS -o /dev/null"
    if [[ "$url" == https://* ]]; then
        curl_opts="$curl_opts -k"
    fi
    while [ "$waited" -lt "$timeout" ]; do
        if curl $curl_opts "$url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done
    return 1
}

wait_for_pid() {
    local pid="$1"
    if [ -z "$pid" ]; then
        return 1
    fi
    while kill -0 "$pid" >/dev/null 2>&1; do
        sleep 5
    done
    return 0
}

stop_services() {
    echo "🛑 Parando serviços..."

    if should_manage_orb_proxy; then
        echo "👉 Verificando orb-proxy..."

        if [ -f "$ORB_PROXY_PID_FILE" ]; then
            ORB_PROXY_PID=$(cat "$ORB_PROXY_PID_FILE" 2>/dev/null || echo "")
        else
            ORB_PROXY_PID=""
        fi

        if [ -n "$ORB_PROXY_PID" ] && kill -0 "$ORB_PROXY_PID" >/dev/null 2>&1; then
            echo "🔍 Matando orb-proxy pelo PID $ORB_PROXY_PID"
            kill_with_timeout "$ORB_PROXY_PID" 5
            rm -f "$ORB_PROXY_PID_FILE"
            sleep 1
        else
            echo "ℹ️  Nenhum PID válido em $ORB_PROXY_PID_FILE, procurando por processos..."
            ORB_PROXY_PIDS=$(ps aux | grep -i 'orb-proxy/server.js' | grep -v grep | awk '{print $2}')
            if [ -n "$ORB_PROXY_PIDS" ]; then
                echo "🔍 Processos orb-proxy encontrados: $ORB_PROXY_PIDS"
                kill_with_timeout "$ORB_PROXY_PIDS" 5
                sleep 1
            else
                echo "✅ Nenhum processo orb-proxy encontrado"
            fi
        fi

        ORB_PROXY_PORT_PIDS=$(lsof -ti:${ORB_PROXY_PORT:-8788} 2>/dev/null)
        if [ -n "$ORB_PROXY_PORT_PIDS" ]; then
            echo "🔍 Processos na porta ${ORB_PROXY_PORT:-8788} (orb-proxy): $ORB_PROXY_PORT_PIDS"
            kill_with_timeout "$ORB_PROXY_PORT_PIDS" 5
            sleep 1
            echo "✅ Porta ${ORB_PROXY_PORT:-8788} liberada"
        fi
    else
        echo "ℹ️  N8N_MANAGE_ORB_PROXY=0: não gerenciar orb-proxy neste script."
    fi

    if should_manage_evolution; then
        ########################################
        # Parar evolution-api
        ########################################

        if [ -f "$EVO_PID_FILE" ]; then
            EVO_PID=$(cat "$EVO_PID_FILE" 2>/dev/null || echo "")
        else
            EVO_PID=""
        fi

        echo "👉 Verificando evolution-api..."

        if [ -n "$EVO_PID" ] && kill -0 $EVO_PID >/dev/null 2>&1; then
            echo "🔍 Matando evolution-api pelo PID $EVO_PID (arquivo $EVO_PID_FILE)"
            kill_with_timeout "$EVO_PID" 5
            rm -f "$EVO_PID_FILE"
            sleep 1
        else
            echo "ℹ️  Nenhum PID válido em $EVO_PID_FILE, procurando por processos..."
            EVO_PIDS=$(ps aux | grep -i 'evolution-api' | grep -v grep | awk '{print $2}')
            if [ -n "$EVO_PIDS" ]; then
                echo "🔍 Processos evolution-api encontrados: $EVO_PIDS"
                kill_with_timeout "$EVO_PIDS" 5
                sleep 1
            else
                echo "✅ Nenhum processo evolution-api encontrado"
            fi
        fi

        # Libera porta 8080 (evolution-api)
        EVO_PORT_PIDS=$(lsof -ti:8080 2>/dev/null)
        if [ -n "$EVO_PORT_PIDS" ]; then
            echo "🔍 Processos na porta 8080 (evolution-api): $EVO_PORT_PIDS"
            kill_with_timeout "$EVO_PORT_PIDS" 5
            sleep 1
            echo "✅ Porta 8080 liberada"
        fi
    else
        echo "ℹ️  N8N_MANAGE_EVOLUTION=0: não gerenciar evolution-api neste script."
    fi

    ########################################
    # Parar n8n
    ########################################

    echo "👉 Verificando n8n..."

    # Encontra e mata todos os processos do n8n
    N8N_PIDS=$(ps aux | grep -i 'n8n start' | grep -v grep | awk '{print $2}')

    if [ -z "$N8N_PIDS" ]; then
        echo "✅ Nenhum processo do n8n encontrado"
    else
        echo "🔍 Processos n8n encontrados: $N8N_PIDS"
        kill_with_timeout "$N8N_PIDS" 5
        sleep 1
        echo "✅ Processos do n8n encerrados"
    fi

    # Limpa processos órfãos na porta 5678
    PORT_PIDS=$(lsof -ti:5678 2>/dev/null)
    if [ -n "$PORT_PIDS" ]; then
        echo "🔍 Processos na porta 5678 (n8n): $PORT_PIDS"
        kill_with_timeout "$PORT_PIDS" 5
        sleep 1
        echo "✅ Porta 5678 liberada"
    fi

    echo ""
    echo "✅ Serviços parados com sucesso!"
}

start_services() {
    prepare_local_runtime_state

    if [ -f "$SCRIPT_DIR/scripts/configure-n8n-runtime-overrides.sh" ]; then
        bash "$SCRIPT_DIR/scripts/configure-n8n-runtime-overrides.sh"
    fi

    # Cria o diretório de binary data se não existi
    local binary_data_dir="${N8N_STORAGE_PATH:-$LOCAL_BINARY_DATA_DIR}"
    if [ ! -d "$binary_data_dir" ]; then
        mkdir -p "$binary_data_dir"
        echo "📁 Diretório binary-data criado em $binary_data_dir"
    fi

    # Exibe configurações importantes
    echo ""
    echo "🚀 Iniciando n8n com as seguintes configurações:"
    echo "   • Binary Data Mode: ${N8N_DEFAULT_BINARY_DATA_MODE:-default}"
    echo "   • Storage Path: ${N8N_STORAGE_PATH:-padrão do sistema}"
    echo "   • Porta: ${N8N_PORT:-5678}"
    echo ""

    # Tenta iniciar o evolution-api em background (se existir)
    if should_manage_evolution && [ -d "evolution-api" ]; then
        printf "\n🔁 Tentando iniciar evolution-api em background...\n"

        # Garante que o script de start esteja executável
        if [ -f "evolution-api/start-evolution-api.sh" ]; then
            chmod +x evolution-api/start-evolution-api.sh

            # Usa variáveis de ambiente para testar o Postgres, com defaults
            DB_HOST_TO_CHECK=${DB_HOST:-localhost}
            DB_PORT_TO_CHECK=${DB_PORT:-5432}

            if command -v nc >/dev/null 2>&1; then
                nc -z "$DB_HOST_TO_CHECK" "$DB_PORT_TO_CHECK"
                DB_OK=$?
            else
                # Se nc não existir, tenta usar pg_isready se disponível
                if command -v pg_isready >/dev/null 2>&1; then
                    pg_isready -q -h "$DB_HOST_TO_CHECK" -p "$DB_PORT_TO_CHECK"
                    DB_OK=$?
                else
                    DB_OK=2
                fi
            fi

            if [ "$DB_OK" -eq 0 ]; then
                echo "✅ PostgreSQL detectado em ${DB_HOST_TO_CHECK}:${DB_PORT_TO_CHECK} — iniciando evolution-api"
            else
                echo "⚠️  PostgreSQL NÃO detectado em ${DB_HOST_TO_CHECK}:${DB_PORT_TO_CHECK}. evolution-api pode falhar ao iniciar. Tentando mesmo assim..."
            fi

            # Inicia em background e guarda PID e log
            nohup bash -lc "cd evolution-api && ./start-evolution-api.sh" > "$EVO_LOG_FILE" 2>&1 &
            EVO_PID=$!
            echo "$EVO_PID" > "$EVO_PID_FILE"
            echo "📄 evolution-api log: $EVO_LOG_FILE"
            sleep 1
            if kill -0 $EVO_PID >/dev/null 2>&1; then
                echo "✅ evolution-api iniciado (PID $EVO_PID)"
            else
                echo "❌ evolution-api terminou logo após iniciar. Verifique $EVO_LOG_FILE"
            fi
        else
            echo "⚠️  Script evolution-api/start-evolution-api.sh não encontrado"
        fi
    elif ! should_manage_evolution; then
        echo "ℹ️  N8N_MANAGE_EVOLUTION=0: pulando start do evolution-api."
    fi

    # Define valores padrão recomendados para evitar deprecations
    export DB_SQLITE_POOL_SIZE=${DB_SQLITE_POOL_SIZE:-5}
    export N8N_BLOCK_ENV_ACCESS_IN_NODE=${N8N_BLOCK_ENV_ACCESS_IN_NODE:-true}
    ensure_required_builtin_allowlist

    echo "   • Node builtins permitidos: ${NODE_FUNCTION_ALLOW_BUILTIN}"

    N8N_PID=$(ps aux | grep -i 'n8n start' | grep -v grep | awk '{print $2}' | head -n 1)
    if [ -n "$N8N_PID" ] && kill -0 "$N8N_PID" >/dev/null 2>&1; then
        echo "ℹ️  n8n já está em execução (PID $N8N_PID), validando health check..."
    else
        # Inicia o n8n em background para executar health check
        n8n start &
        N8N_PID=$!
    fi

    local scheme="${N8N_PROTOCOL:-http}"
    local port="${N8N_PORT:-5678}"
    local url="${scheme}://127.0.0.1:${port}"
    local timeout="${N8N_HEALTHCHECK_TIMEOUT:-30}"

    if ! wait_for_http "$url" "$timeout"; then
        echo "❌ Health check falhou: $url"
        kill_with_timeout "$N8N_PID" 5
        exit 1
    fi

    if should_manage_orb_proxy; then
        local orb_proxy_port="${ORB_PROXY_PORT:-8788}"
        local orb_proxy_address="${ORB_PROXY_LISTEN_ADDRESS:-127.0.0.1}"
        local orb_proxy_url="http://${orb_proxy_address}:${orb_proxy_port}/meta-review/healthz"
        local existing_orb_proxy_pid=""

        existing_orb_proxy_pid=$(ps aux | grep -i 'orb-proxy/server.js' | grep -v grep | awk '{print $2}' | head -n 1)

        if [ -n "$existing_orb_proxy_pid" ] && kill -0 "$existing_orb_proxy_pid" >/dev/null 2>&1; then
            ORB_PROXY_PID="$existing_orb_proxy_pid"
            echo ""
            echo "ℹ️  orb-proxy já está em execução (PID $ORB_PROXY_PID), validando health check..."
        else
            echo ""
            echo "🌐 Iniciando orb-proxy em ${orb_proxy_address}:${orb_proxy_port}"
            nohup node orb-proxy/server.js > "$ORB_PROXY_LOG_FILE" 2>&1 &
            ORB_PROXY_PID=$!
            echo "$ORB_PROXY_PID" > "$ORB_PROXY_PID_FILE"
            sleep 1
        fi

        if ! wait_for_http "$orb_proxy_url" 20; then
            echo "❌ Health check do orb-proxy falhou: $orb_proxy_url"
            kill_with_timeout "$ORB_PROXY_PID" 5
            kill_with_timeout "$N8N_PID" 5
            exit 1
        fi

        echo "✅ orb-proxy iniciado (PID $ORB_PROXY_PID)"
        echo "📄 orb-proxy log: $ORB_PROXY_LOG_FILE"
    fi

    wait_for_pid "$N8N_PID"
}

ACTION="${1:-}"

if [ -z "$ACTION" ] && [ ! -t 0 ]; then
    exit 0
fi

# Carrega as variaveis do arquivo de ambiente se existi
N8N_ENV_TO_LOAD="${N8N_ENV_FILE:-$SCRIPT_DIR/.env}"
if [ -f "$N8N_ENV_TO_LOAD" ]; then
    set -a
    . "$N8N_ENV_TO_LOAD"
    set +a
    echo "✅ Variáveis de ambiente carregadas de $N8N_ENV_TO_LOAD"
else
    echo "⚠️  Arquivo de ambiente não encontrado em $N8N_ENV_TO_LOAD"
fi

if [ -n "$ACTION" ]; then
    case "$ACTION" in
        stop)
            stop_services
            exit 0
            ;;
        start)
            start_services
            exit 0
            ;;
        restart)
            stop_services
            echo ""
            echo "♻️ Iniciando restart dos serviços..."
            start_services
            exit 0
            ;;
        status)
            echo ""
            echo "🔎 Verificando status atual..."
            ps aux | grep -i 'orb-proxy/server.js' | grep -v grep || echo "Nenhum processo orb-proxy em execução"
            ps aux | grep -i 'n8n start' | grep -v grep || echo "Nenhum processo n8n em execução"
            ps aux | grep -i 'evolution-api' | grep -v grep || echo "Nenhum processo evolution-api em execução"
            echo "Porta ${ORB_PROXY_PORT:-8788}:"; lsof -i:${ORB_PROXY_PORT:-8788} 2>/dev/null || echo "  (livre)"
            echo "Porta 5678:"; lsof -i:5678 2>/dev/null || echo "  (livre)"
            echo "Porta 8080:"; lsof -i:8080 2>/dev/null || echo "  (livre)"
            exit 0
            ;;
        *)
            echo "Opção inválida: $ACTION"
            echo "Use: $0 [start|stop|restart|status] ou sem argumentos para menu interativo."
            exit 1
            ;;
    esac
fi

echo ""
echo "📋 O que você deseja fazer?"
echo "  1) Parar serviços (n8n + evolution-api)"
echo "  2) Iniciar serviços (n8n + evolution-api)"
echo "  3) Parar e depois iniciar (restart)"
echo "  4) Apenas verificar status (sem alterações)"
echo "  0) Sair"
echo ""
read -rp "Selecione uma opção [0-4]: " ACTION

case "$ACTION" in
    1)
        stop_services
        ;;
    2)
        start_services
        ;;
    3)
        stop_services
        echo ""
        echo "♻️ Iniciando restart dos serviços..."
        start_services
        ;;
    4)
        echo ""
        echo "🔎 Verificando status atual..."
        ps aux | grep -i 'orb-proxy/server.js' | grep -v grep || echo "Nenhum processo orb-proxy em execução"
        ps aux | grep -i 'n8n start' | grep -v grep || echo "Nenhum processo n8n em execução"
        ps aux | grep -i 'evolution-api' | grep -v grep || echo "Nenhum processo evolution-api em execução"
        echo "Porta ${ORB_PROXY_PORT:-8788}:"; lsof -i:${ORB_PROXY_PORT:-8788} 2>/dev/null || echo "  (livre)"
        echo "Porta 5678:"; lsof -i:5678 2>/dev/null || echo "  (livre)"
        echo "Porta 8080:"; lsof -i:8080 2>/dev/null || echo "  (livre)"
        ;;
    0)
        echo "Saindo sem alterações."
        exit 0
        ;;
    *)
        echo "Opção inválida. Saindo."
        exit 1
        ;;
esac

exit 0
