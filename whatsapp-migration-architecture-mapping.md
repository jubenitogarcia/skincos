# Mapeamento da Arquitetura WhatsApp Oficial - Fase 1 (Análise Pré-Migração)

## 📋 Visão Geral da Análise

Este documento mapeia completamente a estrutura atual do módulo WhatsApp oficial (`whatsapp-official-module`) para preparar a migração para a nova estrutura multi-canal `/whatsapp/1/*`.

**Data da Análise:** 18 de Setembro de 2025  
**Arquivo Principal:** `whatsapp-official-module/official-whatsapp.js`  
**Versão Atual:** 1.0.0

---

## 🛤️ 1. MAPEAMENTO COMPLETO DE ENDPOINTS

### 1.1 Endpoints Principais (Root Level)

```
GET  /                     → Dashboard principal (CRM se cliente ready)
GET  /dashboard           → Dashboard completo WhatsApp Business
GET  /status              → Status básico do cliente
GET  /qr                  → QR Code para autenticação
GET  /info                → Informações detalhadas do cliente
GET  /health              → Health check do sistema
POST /send                → Envio de mensagem básico (legacy)
POST /restart-client      → Reinicialização manual do cliente
GET  /chats               → Lista de chats (legacy)
```

### 1.2 Endpoints API Legacy (/api/*)

```
GET  /api/status                    → Status do cliente com timestamp
GET  /api/qr                       → QR Code atual
POST /api/send-message             → Envio de mensagem text
POST /api/send-media               → Envio de mídia (image, video, document, audio, sticker)
POST /api/send-location            → Envio de localização
GET  /api/restart                  → Reinicialização do cliente
GET  /api/chats                    → Lista todos os chats
GET  /api/chats/:chatId/messages   → Mensagens de um chat específico
GET  /api/contacts                 → Lista todos os contatos
```

### 1.3 Endpoints API V1 (/v1/*) - Estrutura Moderna

#### 1.3.1 Chats Management
```
GET    /v1/chats                   → Lista todos os chats com paginação
GET    /v1/chats/:id              → Detalhes de chat específico
POST   /v1/chats/:id/archive      → Arquivar chat
DELETE /v1/chats/:id/archive      → Desarquivar chat
POST   /v1/chats/:id/pin          → Fixar chat
DELETE /v1/chats/:id/pin          → Desfixar chat
POST   /v1/chats/:id/mute         → Silenciar chat
DELETE /v1/chats/:id/mute         → Desilenciar chat
POST   /v1/chats/:id/read         → Marcar como lido
```

#### 1.3.2 Messages Management
```
POST /v1/messages                 → Enviar nova mensagem
GET  /v1/messages                 → Lista mensagens com filtros
GET  /v1/messages/:id             → Detalhes de mensagem específica
```

#### 1.3.3 Contacts Management
```
GET /v1/contacts                  → Lista todos os contatos
GET /v1/contacts/:id              → Detalhes de contato específico
GET /v1/contacts/:id/avatar       → Avatar do contato
GET /v1/contacts/:id/common-groups → Grupos em comum
```

#### 1.3.4 Media Management
```
POST /v1/media                   → Envio de mídia avançado
```

#### 1.3.5 Groups Management
```
GET /v1/groups                   → Lista grupos
GET /v1/groups/:id/participants  → Participantes de grupo
```

#### 1.3.6 Webhooks Management
```
POST   /v1/webhooks              → Criar webhook
GET    /v1/webhooks              → Listar webhooks
DELETE /v1/webhooks/:id          → Deletar webhook
POST   /v1/webhooks/test         → Testar webhook
GET    /v1/webhooks/:id/deliveries → Histórico de entregas
```

#### 1.3.7 Status Endpoints
```
GET /v1/status                   → Status detalhado V1
```

---

## 🔐 2. SISTEMA DE SESSÕES E AUTENTICAÇÃO

### 2.1 Configuração LocalAuth
```javascript
authStrategy: new LocalAuth({
    clientId: CLIENT_ID,
    dataPath: DATA_PATH
})
```

### 2.2 Variáveis de Configuração
```javascript
CLIENT_ID = process.env.WHATSAPP_CLIENT_ID || 'whatsapp-official-replit'
DATA_PATH = process.env.WHATSAPP_DATA_PATH || path.join(__dirname, 'sessions', 'session-' + CLIENT_ID)
CHROMIUM_PATH = process.env.CHROMIUM_EXECUTABLE_PATH || '/nix/store/.../chromium'
USER_DATA_DIR = process.env.WHATSAPP_USER_DATA_DIR || path.join(os.tmpdir(), `whatsapp-chromium-${CLIENT_ID}`)
```

### 2.3 Estados de Cliente
- `disconnected` → Cliente desconectado
- `loading: X% - message` → Carregando
- `qr_received` → QR code disponível
- `authenticated` → Autenticado
- `ready` → Pronto para uso
- `auth_failure` → Falha na autenticação
- `recovering` → Em recuperação
- `browser_crashed` → Browser crashou
- `page_closed` → Página fechada
- `browser_disconnected` → Browser desconectado
- `recovery_failed` → Recuperação falhou

### 2.4 Sistema de Recuperação Automática
- Retry automático até 3 tentativas
- Limpeza de diretórios de dados do browser
- Reconfiguração completa do cliente
- Exponential backoff para tentativas

---

## 🔔 3. SISTEMA DE WEBHOOKS

### 3.1 Estrutura de Dados
```javascript
// Armazenamento em memória
webhooksStore = []              // Lista de webhooks configurados
eventsStore = []               // Histórico de eventos
webhookDeliveriesStore = []    // Histórico de entregas
```

### 3.2 Configuração de Webhook
```javascript
{
    id: string,           // UUID único
    url: string,          // URL de destino
    events: array,        // Eventos a escutar (vazio = todos)
    active: boolean,      // Status ativo/inativo
    secret: string,       // Chave secreta para assinatura
    createdAt: timestamp
}
```

### 3.3 Eventos Disponíveis
- `message_received` → Mensagem recebida
- `message_sent` → Mensagem enviada  
- `test` → Evento de teste

### 3.4 Headers de Webhook
```javascript
'Content-Type': 'application/json'
'X-Webhook-Id': webhook.id
'X-Signature': HMAC-SHA256 signature
'X-Event-Id': eventId
'X-Event-Type': eventType
'X-Event-Version': '1'
```

### 3.5 Sistema de Retry
- Máximo 3 tentativas por webhook
- Exponential backoff (1s, 2s, 4s)
- Tracking completo de tentativas e erros

---

## 🧩 4. EXTENSÕES MODULARES

### 4.1 MediaHandler (extensions/media-handler.js)
**Funcionalidades:**
- Envio de imagens, vídeos, documentos, áudios, stickers
- Conversão automática de formatos via FFmpeg
- Compressão inteligente de vídeos (3 níveis)
- Validação de URLs e segurança
- Sistema de retry com detecção de crash

**Dependências Críticas:**
- `fluent-ffmpeg` para conversão de mídia
- `axios` para download de arquivos
- `media-converter.js` para processamento

### 4.2 ChatManager (extensions/chat-manager.js)
**Funcionalidades:**
- Gestão completa de chats
- Arquivamento, fixação, silenciamento
- Busca de mensagens com limite
- Marcação como lido
- Exclusão de chats

### 4.3 ContactManager (extensions/contact-manager.js)
**Funcionalidades:**
- Gestão de contatos
- Verificação de números registrados
- Bloqueio/desbloqueio
- Busca de grupos em comum
- Avatar e informações de perfil

### 4.4 MediaConverter (extensions/media-converter.js)
**Funcionalidades Críticas:**
- Conversão de áudio para OGG/Opus
- Compressão de vídeo para MP4 H.264+AAC
- Análise automática de necessidade de conversão
- Sistema de qualidade escalonado (3 tentativas)
- Limpeza automática de arquivos temporários

---

## 📦 5. DEPENDÊNCIAS E INTEGRAÇÕES

### 5.1 Dependências NPM Principais
```json
{
    "axios": "^1.12.2",          // HTTP requests
    "cors": "^2.8.5",            // CORS handling
    "crypto-js": "^4.2.0",       // Cryptography
    "express": "^4.18.2"         // Web framework
}
```

### 5.2 Dependências Externas Críticas
- **WhatsApp Web.js** → `require('../whatsapp-official')`
- **FFmpeg** → `require('fluent-ffmpeg')` (sistema)
- **Chromium** → `/nix/store/.../chromium` (binário)

### 5.3 Integrações de Sistema
- **Sistema de arquivos** → Sessões em `./sessions/`
- **Diretório temporário** → `/tmp/whatsapp-chromium-*`
- **Variáveis de ambiente** → Configuração flexível
- **Process handlers** → Graceful shutdown

---

## 🔄 6. PLANO DE MIGRAÇÃO PARA /whatsapp/1/*

### 6.1 Estrutura de Migração Proposta

#### Current Structure → New Structure
```
/api/*           → /whatsapp/1/api/*
/v1/*            → /whatsapp/1/*
/status          → /whatsapp/1/status
/qr              → /whatsapp/1/qr
/send            → /whatsapp/1/send
/chats           → /whatsapp/1/chats
/dashboard       → /whatsapp/1/dashboard
/                → /whatsapp/1/
```

### 6.2 Mapeamento Detalhado de Rotas

#### 6.2.1 Endpoints de Status
```
OLD: GET /status              → NEW: GET /whatsapp/1/status
OLD: GET /api/status          → NEW: GET /whatsapp/1/api/status  
OLD: GET /v1/status           → NEW: GET /whatsapp/1/status
OLD: GET /health              → NEW: GET /whatsapp/1/health
OLD: GET /info                → NEW: GET /whatsapp/1/info
```

#### 6.2.2 Endpoints de Autenticação
```
OLD: GET /qr                  → NEW: GET /whatsapp/1/qr
OLD: GET /api/qr              → NEW: GET /whatsapp/1/api/qr
```

#### 6.2.3 Endpoints de Mensagens
```
OLD: POST /send               → NEW: POST /whatsapp/1/send
OLD: POST /api/send-message   → NEW: POST /whatsapp/1/api/send-message
OLD: POST /v1/messages        → NEW: POST /whatsapp/1/messages
OLD: GET /v1/messages         → NEW: GET /whatsapp/1/messages
OLD: GET /v1/messages/:id     → NEW: GET /whatsapp/1/messages/:id
```

#### 6.2.4 Endpoints de Chats
```
OLD: GET /chats               → NEW: GET /whatsapp/1/chats
OLD: GET /api/chats           → NEW: GET /whatsapp/1/api/chats
OLD: GET /v1/chats            → NEW: GET /whatsapp/1/chats
OLD: GET /v1/chats/:id        → NEW: GET /whatsapp/1/chats/:id
OLD: POST /v1/chats/:id/*     → NEW: POST /whatsapp/1/chats/:id/*
OLD: DELETE /v1/chats/:id/*   → NEW: DELETE /whatsapp/1/chats/:id/*
```

#### 6.2.5 Endpoints de Contatos
```
OLD: GET /api/contacts        → NEW: GET /whatsapp/1/api/contacts
OLD: GET /v1/contacts         → NEW: GET /whatsapp/1/contacts
OLD: GET /v1/contacts/:id     → NEW: GET /whatsapp/1/contacts/:id
OLD: GET /v1/contacts/:id/*   → NEW: GET /whatsapp/1/contacts/:id/*
```

#### 6.2.6 Endpoints de Mídia
```
OLD: POST /api/send-media     → NEW: POST /whatsapp/1/api/send-media
OLD: POST /api/send-location  → NEW: POST /whatsapp/1/api/send-location
OLD: POST /v1/media           → NEW: POST /whatsapp/1/media
```

#### 6.2.7 Endpoints de Webhooks
```
OLD: POST /v1/webhooks        → NEW: POST /whatsapp/1/webhooks
OLD: GET /v1/webhooks         → NEW: GET /whatsapp/1/webhooks
OLD: DELETE /v1/webhooks/:id  → NEW: DELETE /whatsapp/1/webhooks/:id
OLD: POST /v1/webhooks/test   → NEW: POST /whatsapp/1/webhooks/test
OLD: GET /v1/webhooks/:id/*   → NEW: GET /whatsapp/1/webhooks/:id/*
```

#### 6.2.8 Endpoints de Grupos
```
OLD: GET /v1/groups           → NEW: GET /whatsapp/1/groups
OLD: GET /v1/groups/:id/*     → NEW: GET /whatsapp/1/groups/:id/*
```

#### 6.2.9 Endpoints de Controle
```
OLD: GET /api/restart         → NEW: GET /whatsapp/1/api/restart
OLD: POST /restart-client     → NEW: POST /whatsapp/1/restart-client
```

#### 6.2.10 Endpoints de Interface
```
OLD: GET /                    → NEW: GET /whatsapp/1/
OLD: GET /dashboard           → NEW: GET /whatsapp/1/dashboard
```

### 6.3 Considerações de Compatibilidade

#### 6.3.1 Backward Compatibility
- Manter rotas antigas ativas durante período de transição
- Implementar redirecionamentos 301 para novas rotas
- Headers de depreciação em respostas antigas

#### 6.3.2 Configuração de Sessões
```javascript
// Atual
CLIENT_ID = 'whatsapp-official-replit'
DATA_PATH = './sessions/session-whatsapp-official-replit'

// Migração
CLIENT_ID = 'whatsapp-channel-1'  // ou 'whatsapp-1'
DATA_PATH = './sessions/whatsapp/1/session-whatsapp-channel-1'
```

#### 6.3.3 Webhooks Migration
- Migrar webhooks existentes para nova estrutura
- Atualizar eventos para incluir channel ID
- Payload format: `{ channel: 'whatsapp/1', ... }`

---

## ⚠️ 7. PONTOS CRÍTICOS PARA MIGRAÇÃO

### 7.1 Impactos de Quebra
1. **URLs absolutas** em clientes externos precisarão ser atualizadas
2. **Webhooks configurados** precisarão ser reconfigurados
3. **Sessões existentes** podem precisar ser movidas/reconfiguradas
4. **Cache de frontend** pode precisar invalidação

### 7.2 Dependências Que Precisam Atualização
1. **Arquivos de extensão** → Paths relativos podem quebrar
2. **Configurações de sessão** → Diretórios e IDs de cliente
3. **Sistema de recovery** → Logs e identificação de crash
4. **Dashboard frontend** → URLs de API
5. **Configurações de proxy** (se houver)

### 7.3 Testes Críticos Pós-Migração
1. **Autenticação** → QR Code e persistência de sessão
2. **Envio de mensagens** → Todos os tipos (text, media, location)
3. **Webhooks** → Recebimento e entrega de eventos
4. **Conversão de mídia** → FFmpeg e processos temporários
5. **Recovery automático** → Crash handling e restart
6. **Dashboard** → Interface e funcionalidades

---

## 📋 8. RESUMO EXECUTIVO

### 8.1 Total de Endpoints Identificados
- **39 endpoints únicos** mapeados
- **3 estruturas de API** coexistindo (root, /api/*, /v1/*)
- **8 categorias funcionais** (status, auth, messages, chats, contacts, media, webhooks, groups)

### 8.2 Complexidade da Migração
- **BAIXA** → Mudança de prefixo de rota
- **MÉDIA** → Reconfiguração de sessões e webhooks  
- **ALTA** → Testes completos de integração

### 8.3 Tempo Estimado de Migração
- **Preparação:** 4-6 horas
- **Implementação:** 8-12 horas  
- **Testes:** 6-8 horas
- **Total:** 18-26 horas

### 8.4 Próximos Passos Recomendados
1. Criar branch de migração
2. Implementar estrutura /whatsapp/1/* mantendo compatibilidade
3. Atualizar configurações de sessão progressivamente
4. Migrar webhooks existentes
5. Testar todos os endpoints
6. Documentar mudanças para clientes
7. Planejar depreciação de rotas antigas

---

**Documento gerado automaticamente pela análise do sistema em 18/09/2025**  
**Responsável:** Subagent Analysis Task  
**Próxima fase:** Implementação da migração para estrutura multi-canal