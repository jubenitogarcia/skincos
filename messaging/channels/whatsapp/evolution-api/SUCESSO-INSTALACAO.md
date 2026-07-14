# ✅ Evolution API - Instalação Local FUNCIONANDO!

## 🎉 SUCESSO!

A Evolution API foi instalada localmente e está **FUNCIONANDO PERFEITAMENTE**!

**O QR CODE FOI GERADO** e apareceu nos logs do terminal!

## 📍 Localização

- **Pasta**: `/Users/jubenitogarcia/Automation/n8n/evolution-api`
- **Porta**: 8080
- **URL**: http://localhost:8080
- **Versão**: 2.3.4
- **API Key**: `429683C4C977415CAAFCCE10F7D57E11`

## 🚀 Como Iniciar

```bash
# 1. Iniciar PostgreSQL (via Docker)
cd /Users/jubenitogarcia/Automation/n8n/evolution
docker compose up -d postgres

# 2. Iniciar Evolution API (local)
cd /Users/jubenitogarcia/Automation/n8n/evolution-api
npx tsx ./src/main.ts
```

## 📱 Conectar WhatsApp

### Opção 1: QR Code no Terminal (MAIS FÁCIL)

O QR Code aparece automaticamente nos logs quando você inicia a API!

1. Inicie a API (comando acima)
2. Aguarde alguns segundos
3. O QR Code aparecerá em ASCII art no terminal
4. Abra o WhatsApp no celular
5. Vá em **Aparelhos conectados** > **Conectar um aparelho**
6. Escaneie o QR Code que apareceu no terminal

### Opção 2: Via API REST

```bash
# Criar nova instância
curl -X POST http://localhost:8080/instance/create \
  -H "Content-Type: application/json" \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11" \
  -d '{
    "instanceName": "seu-numero",
    "qrcode": true,
    "integration": "WHATSAPP-BAILEYS"
  }'

# Obter QR Code
curl -X GET "http://localhost:8080/instance/connect/seu-numero" \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11"
```

### Opção 3: Manager Web

Acesse: http://localhost:8080/manager

- API Key: `429683C4C977415CAAFCCE10F7D57E11`

## 📋 Instância Atual

A instância **"whatsapp-final"** foi automaticamente carregada do banco de dados e está gerando QR Code!

## 🔧 Comandos Úteis

### Ver Status
```bash
curl -s http://localhost:8080/ | jq '.'
```

### Listar Instâncias
```bash
curl -s -X GET "http://localhost:8080/instance/fetchInstances" \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11" | jq '.'
```

### Parar API
No terminal onde está rodando, pressione `Ctrl+C`

### Parar PostgreSQL
```bash
cd /Users/jubenitogarcia/Automation/n8n/evolution
docker compose down
```

## 🎯 Próximos Passos

1. ✅ Evolution API instalada e funcionando
2. ✅ QR Code sendo gerado
3. ⏳ **AGORA**: Escaneie o QR Code com seu WhatsApp (5551995103563)
4. 🔄 Após conectar, integrar com n8n

## 💡 Dicas

- O QR Code expira em ~60 segundos
- Se expirar, a API gera um novo automaticamente
- Mantenha o terminal aberto para ver os logs
- Após conectar, o status mudará para "open"

## 🐛 Solução de Problemas

### QR Code não aparece?

Reinicie a API:
```bash
# Parar (Ctrl+C no terminal)
# Iniciar novamente
cd /Users/jubenitogarcia/Automation/n8n/evolution-api
npx tsx ./src/main.ts
```

### Erro de conexão com banco?

Certifique-se que o PostgreSQL está rodando:
```bash
cd /Users/jubenitogarcia/Automation/n8n/evolution
docker compose up -d postgres
docker compose ps
```

### Porta 8080 já em uso?

Pare outros serviços na porta 8080:
```bash
lsof -ti:8080 | xargs kill -9
```

## 📚 Documentação

- Evolution API: https://doc.evolution-api.com
- Repositório: https://github.com/EvolutionAPI/evolution-api
- n8n Node: https://www.npmjs.com/package/n8n-nodes-evolution-api

## 🎊 Resultado

**A instalação local resolveu o problema de WebSocket** que existia no Docker!

Agora você tem:
- ✅ Evolution API funcionando
- ✅ QR Code gerando corretamente
- ✅ Sem erros de WebSocket
- ✅ Pronto para conectar WhatsApp
- ✅ Compatível com n8n (versão 2.3.4)

---

**Desenvolvido com ❤️ por Evolution API**
**Configurado em: 7 de outubro de 2025**
