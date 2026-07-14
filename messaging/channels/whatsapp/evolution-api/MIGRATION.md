# Evolution API - Migração Cluster PostgreSQL 15 → 16

## Resumo Executivo

Migração bem-sucedida da Evolution API de PostgreSQL 15 para PostgreSQL 16 com preservação completa de dados históricos (instâncias, chats, contatos, mensagens).

**Data**: 20 de novembro de 2025
**Status**: ✅ Completo
**Downtime**: ~3 minutos (parada cluster 15 + inicialização cluster 16)

---

## Problemas Resolvidos

### 1. Perda de Instâncias WhatsApp
- **Causa**: Cluster PostgreSQL 16 vazio; dados históricos no cluster 15
- **Solução**: Alternância entre clusters, manutenção de cluster 15 para backup/restore

### 2. Loop Infinito de Reconexão
- **Causa**: Reconexão imediata ao desconectar sem backoff; listeners duplicados
- **Solução**:
  - Implementado backoff exponencial (1s, 2s, … até 10s)
  - Limite de 10 tentativas antes de parar
  - Limpeza de listeners antigos ao criar novo cliente
  - Supressão de estados duplicados (early return)

### 3. Erros de Criptografia Massivos
- **Causa**: Histórico completo reprocessado causando conflitos de MessageCounter
- **Solução**:
  - `CONFIG_DISABLE_FULL_HISTORY=false` (agora reativado após estabilização)
  - `LOG_DECRYPT_ERRORS_LIMIT=50` para limitar output
  - Rate limiting de erros criptográficos

### 4. Falhas Prisma (MessageUpdate sem relação Message)
- **Causa**: Persistência de `messageUpdate` sem validação de `messageId`
- **Solução**: Condicional `if (message.messageId)` antes de criar `messageUpdate`

### 5. Acúmulo de Chaves de Sessão
- **Causa**: ~3000 arquivos `session-*` e `sender-key-*` causando conflitos
- **Solução**: Limpeza seletiva de arquivos por instância

---

## Passos de Migração Executados

### Fase 1: Backup (Cluster 15)
```bash
# Criar dump completo do cluster 15
/opt/homebrew/opt/postgresql@15/bin/pg_dump \
  -h localhost \
  -U jubenitogarcia \
  evolution > backup/evolution_cluster15.sql
# Resultado: ~470MB de dados
```

### Fase 2: Preparação (Cluster 16)
```bash
# Parar cluster 15
brew services stop postgresql@15

# Inicializar cluster 16
/opt/homebrew/opt/postgresql@16/bin/initdb \
  -D /opt/homebrew/var/postgresql@16

# Iniciar cluster 16
/opt/homebrew/opt/postgresql@16/bin/pg_ctl \
  -D /opt/homebrew/var/postgresql@16 start

# Criar banco de dados
/opt/homebrew/opt/postgresql@16/bin/createdb \
  -h localhost \
  -U jubenitogarcia \
  evolution
```

### Fase 3: Restore (Cluster 16)
```bash
# Restaurar dump completo
/opt/homebrew/opt/postgresql@16/bin/psql \
  -h localhost \
  -U jubenitogarcia \
  evolution < backup/evolution_cluster15.sql

# Criar role evolutionuser (se necessário)
/opt/homebrew/opt/postgresql@16/bin/psql \
  -h localhost \
  -U jubenitogarcia \
  -d postgres \
  -c "CREATE ROLE evolutionuser SUPERUSER CREATEDB LOGIN ENCRYPTED PASSWORD 'password';"

# Validação
/opt/homebrew/opt/postgresql@16/bin/psql \
  -h localhost \
  -U jubenitogarcia \
  evolution \
  -c "SELECT COUNT(*) as Instance FROM \"Instance\";"
# Resultado: 3 instâncias
```

### Fase 4: Atualização Aplicação
```bash
# Atualizar .env com nova conexão
# De: postgresql://evolutionuser:evolutionpass@localhost:5432/evolution?schema=public
# Para: postgresql://evolutionuser:password@localhost:5432/evolution?schema=public
# (Mesma porta 5432, agora PG16)

# Regenerar Prisma client
export DATABASE_PROVIDER=postgresql
npm run db:generate

# Reiniciar servidor
npm run dev:server
```

### Fase 5: Validação Pós-Migração
```bash
# Verificar instâncias
curl -X GET http://localhost:8080/instance/fetchInstances \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11"

# Resultado: 3 instâncias conectadas (state: open)
```

---

## Ajustes de Configuração Aplicados

### `.env` - Flags Persistência
```bash
# Persistências de dados (reativadas após estabilização)
DATABASE_SAVE_DATA_INSTANCE=true           # Metadados instância
DATABASE_SAVE_DATA_NEW_MESSAGE=true        # Mensagens novas
DATABASE_SAVE_MESSAGE_UPDATE=true          # Status mensagens (reativado)
DATABASE_SAVE_DATA_HISTORIC=true           # Histórico sincronizado (reativado)
DATABASE_SAVE_IS_ON_WHATSAPP=true          # Validação números
```

### `.env` - Flags Controle
```bash
LOG_DECRYPT_ERRORS_LIMIT=50                # Limitar ruído criptografia
CONFIG_DISABLE_FULL_HISTORY=false          # Sincronizar histórico normal
```

### `whatsapp.baileys.service.ts` - Patches
1. **Reconexão com backoff**: Limite de 10 tentativas, backoff incremental (1s-10s)
2. **Listener cleanup**: Remover listeners antigos ao criar novo cliente
3. **Deduplicação de estado**: Early return se estado não mudar
4. **Condicional messageUpdate**: Só persistir se `message.messageId` existir
5. **Histórico condicional**: Respeitar flag `CONFIG_DISABLE_FULL_HISTORY`

---

## Métricas de Estabilização

### Antes (Cluster 15 - Estado Instável)
- stream errored out: 48 (60s)
- Reconexões (connecting): 52 (60s)
- Estados open: 24 (60s)
- Comportamento: Ciclo rápido connecting → connecting → open → connecting

### Depois (Cluster 16 - Estável)
- Sem loop infinito (limite de 10 tentativas implementado)
- Instâncias mantêm estado open estável
- Rate limiting reduz saída de erros criptográficos
- Limpeza de sessões eliminou conflitos de chaves

---

## Rollback (Se Necessário)

### Reverter para Cluster 15
```bash
# Parar cluster 16
/opt/homebrew/opt/postgresql@16/bin/pg_ctl \
  -D /opt/homebrew/var/postgresql@16 stop

# Iniciar cluster 15
brew services start postgresql@15

# Atualizar .env para apontar cluster 15 (se mudou porta)
# Reiniciar servidor
npm run dev:server
```

---

## Checklist Pós-Migração

- [x] Cluster PostgreSQL 16 inicializado e rodando
- [x] Dump PostgreSQL 15 restaurado com sucesso
- [x] 3 instâncias WhatsApp carregadas (Instance table)
- [x] Dados históricos preservados (Chats, Contacts, Messages)
- [x] Servidor Evolution API conectado e operacional (porta 8080)
- [x] Instâncias com estado 'open' (conectadas)
- [x] MessageUpdate reativado sem exceções Prisma
- [x] Histórico reativado sem reprocessamento massivo
- [x] Patches de reconexão validados (backoff, deduplicação)
- [x] Sessões limpas (0 arquivos session-* / sender-key-*)

---

## Recomendações Futuras

1. **Monitoramento**: Implementar alertas para reconexões acima de threshold
2. **Limpeza de Logs**: Manter `LOG_DECRYPT_ERRORS_LIMIT=50` em produção
3. **Histórico**: Avaliar necessidade de `CONFIG_DISABLE_FULL_HISTORY` conforme volume de dados
4. **Backup Automático**: Agendar `pg_dump` diário (ex: cron job)
5. **Testes de Carga**: Validar com múltiplas instâncias conectadas simultaneamente

---

## Contato & Suporte

Migração concluída por: Evolution API Maintenance
Versão: 2.3.4
Ambiente: macOS (Homebrew PostgreSQL)
