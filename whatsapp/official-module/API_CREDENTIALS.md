# WhatsApp Multi-Channel System - API Credentials

## Credenciais de Autenticação

### API Keys Padrão (Fase 1 - Teste)

As seguintes credenciais estão configuradas para autenticação das APIs:

**1. WHATSAPP_API_KEY (Principal)**
- Valor: `whatsapp-secure-key-2024`
- Uso: APIs gerais do WhatsApp Multi-Channel

**2. ADMIN_API_KEY (Administração)**
- Valor: `admin-master-key-2024`  
- Uso: APIs administrativas e operações críticas

**3. CHANNEL_MANAGER_KEY (Gerenciamento de Canais)**
- Valor: `channel-mgr-key-2024`
- Uso: APIs de gerenciamento de canais

### JWT Secret
- Configurado via variável de ambiente JWT_SECRET
- Status: ✅ Configurado

### Como Usar as Credenciais

**Método 1: Header x-api-key**
```bash
curl -H "x-api-key: whatsapp-secure-key-2024" http://localhost:3001/api/endpoint
```

**Método 2: Authorization Bearer**
```bash
curl -H "Authorization: Bearer whatsapp-secure-key-2024" http://localhost:3001/api/endpoint
```

**Método 3: Authorization ApiKey**
```bash
curl -H "Authorization: ApiKey whatsapp-secure-key-2024" http://localhost:3001/api/endpoint
```

**Método 4: Query Parameter**
```bash
curl http://localhost:3001/api/endpoint?api_key=whatsapp-secure-key-2024
```

### Endpoints Principais

**Sistema de Status:**
- GET `/api/channel-manager/system/status` - Status do sistema

**Gerenciamento de Licenças:**
- GET `/api/channel-manager/licenses` - Listar licenças
- POST `/api/channel-manager/licenses` - Adicionar licença

**Gerenciamento de Canais:**
- GET `/api/channel-manager/channels` - Listar canais
- POST `/api/channel-manager/channels/:id/activate` - Ativar canal
- GET `/api/channel-manager/channels/:id/qr` - Obter QR Code

### Configurações de Segurança

**Rate Limiting:**
- Strict: 10 req/15min para APIs críticas
- Moderate: 100 req/15min para APIs normais  
- Lenient: 1000 req/15min para consultas

**IP Allowlist:**
- 127.0.0.1, ::1, localhost permitidos
- Configuração de IP administrativo via ADMIN_IP

**Proteções Implementadas:**
- ✅ Autenticação via API Key/JWT
- ✅ Rate limiting diferenciado
- ✅ Validação de entrada rigorosa
- ✅ Sanitização de channelId
- ✅ Proteção CSRF
- ✅ CORS configurado

---

**Nota de Segurança:** Estas são credenciais de teste para Fase 1. Em produção, configurar variáveis de ambiente apropriadas.