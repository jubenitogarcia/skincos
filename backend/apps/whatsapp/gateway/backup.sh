#!/bin/bash

# 💾 Script de Backup - Dados do WhatsApp API
# Versão: 2.0.0
# Data: 1 de agosto de 2025

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="whatsapp_backup_$TIMESTAMP"

echo "💾 Iniciando backup dos dados do WhatsApp API..."
echo "📅 Data: $(date)"
echo ""

# Criar diretório de backup
mkdir -p "$BACKUP_DIR"

# Função para log
log() {
    echo "[$(date '+%H:%M:%S')] $1"
}

log "📁 Criando backup: $BACKUP_NAME"

# Parar container temporariamente para backup consistente
log "⏸️  Pausando container para backup seguro..."
docker-compose pause whatsapp-api

# Criar backup dos volumes Docker
log "💾 Fazendo backup dos volumes Docker..."
docker run --rm \
    -v whatsapp_whatsapp_auth:/data/auth \
    -v whatsapp_whatsapp_cache:/data/cache \
    -v "$(pwd)/$BACKUP_DIR":/backup \
    alpine:latest sh -c "
        cd /data &&
        tar czf /backup/${BACKUP_NAME}_auth.tar.gz auth/ &&
        tar czf /backup/${BACKUP_NAME}_cache.tar.gz cache/ &&
        echo 'Backup dos volumes concluído'
    "

# Backup da configuração
log "⚙️  Fazendo backup da configuração..."
tar czf "$BACKUP_DIR/${BACKUP_NAME}_config.tar.gz" \
    docker-compose.yml \
    Dockerfile \
    traefik.yml \
    bot_com_api.js \
    package.json \
    *.sh \
    2>/dev/null

# Retomar container
log "▶️  Retomando container..."
docker-compose unpause whatsapp-api

# Verificar se API voltou
log "🔍 Verificando se API voltou..."
sleep 10
if curl -sf http://localhost:3001/status > /dev/null; then
    log "✅ API funcionando normalmente"
else
    log "⚠️  API pode estar iniciando ainda..."
fi

# Informações do backup
BACKUP_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
log "📊 Backup concluído!"
echo ""
echo "📁 Localização: $BACKUP_DIR"
echo "📏 Tamanho total: $BACKUP_SIZE"
echo "📋 Arquivos criados:"
ls -la "$BACKUP_DIR"/*"$TIMESTAMP"* 2>/dev/null || echo "Nenhum arquivo encontrado"

# Limpeza de backups antigos (manter últimos 7 dias)
log "🧹 Limpando backups antigos (>7 dias)..."
find "$BACKUP_DIR" -name "whatsapp_backup_*" -type f -mtime +7 -delete 2>/dev/null || true

echo ""
echo "💡 Para restaurar backup:"
echo "   1. Parar containers: docker-compose down"
echo "   2. Extrair backups: tar xzf $BACKUP_DIR/${BACKUP_NAME}_*.tar.gz"
echo "   3. Reiniciar: docker-compose up -d"
