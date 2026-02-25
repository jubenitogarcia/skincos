#!/bin/bash

# Evolution API - Backup Automatizado PostgreSQL 16
# Uso: ./backup-evolution.sh [daily|weekly]

set -euo pipefail

BACKUP_DIR="/Users/jubenitogarcia/Automation/n8n/evolution-api/backup"
PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
DB_NAME="evolution"
DB_USER="evolutionuser"
DB_HOST="localhost"
DB_PORT="5432"
RETENTION_DAYS=30  # Manter backups por 30 dias
RETENTION_WEEKLY=12  # Manter backups semanais por 12 semanas

# Criar diretório se não existir
mkdir -p "$BACKUP_DIR"/{daily,weekly}

# Função de log
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Função de backup
create_backup() {
    local type="$1"
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local backup_file="$BACKUP_DIR/$type/evolution_${type}_${timestamp}.sql"

    log "Iniciando backup $type para $backup_file"

    # Executar pg_dump
    PGPASSWORD=password "$PG_BIN/pg_dump" \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --verbose \
        --no-owner \
        --no-privileges \
        > "$backup_file"

    # Comprimir backup
    gzip "$backup_file"
    local compressed_file="${backup_file}.gz"

    # Verificar tamanho
    local size=$(du -h "$compressed_file" | cut -f1)
    log "Backup $type concluído: $compressed_file ($size)"

    return 0
}

# Função de limpeza
cleanup_old_backups() {
    local type="$1"
    local retention="$2"

    log "Limpando backups $type mais antigos que $retention dias"

    find "$BACKUP_DIR/$type" -name "evolution_${type}_*.sql.gz" -mtime +$retention -delete

    local remaining=$(find "$BACKUP_DIR/$type" -name "evolution_${type}_*.sql.gz" | wc -l)
    log "Backups $type restantes: $remaining"
}

# Função principal
main() {
    local backup_type="${1:-daily}"

    case "$backup_type" in
        daily)
            create_backup "daily"
            cleanup_old_backups "daily" "$RETENTION_DAYS"
            ;;
        weekly)
            create_backup "weekly"
            cleanup_old_backups "weekly" "$((RETENTION_WEEKLY * 7))"
            ;;
        *)
            log "Erro: Tipo de backup inválido. Use 'daily' ou 'weekly'"
            exit 1
            ;;
    esac

    log "Backup $backup_type finalizado com sucesso"
}

# Executar se chamado diretamente
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
