# 🚀 Evolution API - Instalação Local

## ✅ Status Atual

- ✅ **Evolution API**: Instalada localmente (porta 8080)
- ⚠️ **WhatsApp**: Aguardando conexão (instância: whatsapp-final)
- ✅ **Banco de Dados**: PostgreSQL configurado e rodando
- ✅ **PostgreSQL**: Rodando na porta 5432
- ✅ **n8n**: Instalado localmente

---

## ⚠️ O que aconteceu com a instância anterior?

A instância **whatsapp-final** que estava conectada foi perdida quando o banco de dados foi recriado. Isso aconteceu porque:

1. O PostgreSQL não estava rodando inicialmente
2. Foi necessário executar `npm run db:deploy` para criar as tabelas
3. Esse comando aplicou as migrations como uma instalação limpa, apagando dados antigos

**Para reconectar o WhatsApp**, você tem duas opções:

### Opção 1: Conectar via QR Code no Manager
1. Acesse: http://localhost:8080/manager
2. Use a API Key: `429683C4C977415CAAFCCE10F7D57E11`
3. Clique na instância **whatsapp-final**
4. Escaneie o QR Code com seu WhatsApp

### Opção 2: Obter QR Code via API
```bash
curl -X GET "http://localhost:8080/instance/connect/whatsapp-final" \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11"
```

---

## 🔧 Como Iniciar

### 0. Garantir que o PostgreSQL está rodando

**Verificar status:**
```bash
brew services list | grep postgresql
```

**Iniciar PostgreSQL (se não estiver rodando):**
```bash
brew services start postgresql@15
```

**Verificar se o banco de dados existe:**
```bash
export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"
psql -l | grep evolution
```

### 1. Iniciar Evolution API

```bash
cd /Users/jubenitogarcia/Automation/n8n/evolution-api
node dist/main
```

Ou usando o npm:

```bash
cd /Users/jubenitogarcia/Automation/n8n/evolution-api
npm start
```

### 2. Verificar se está rodando

```bash
curl http://localhost:8080
```

### 3. Ver instâncias conectadas

```bash
curl -X GET "http://localhost:8080/instance/fetchInstances" \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11"
```

---

## 📱 Gerenciar WhatsApp

### Ver status da conexão

```bash
curl -X GET "http://localhost:8080/instance/connectionState/whatsapp-final" \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11"
```

### Enviar mensagem de teste

```bash
curl -X POST "http://localhost:8080/message/sendText/whatsapp-final" \
  -H "Content-Type: application/json" \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11" \
  -d '{
    "number": "5551995103563",
    "text": "Mensagem de teste!"
  }'
```

### Desconectar WhatsApp

```bash
curl -X DELETE "http://localhost:8080/instance/logout/whatsapp-final" \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11"
```

### Deletar instância

```bash
curl -X DELETE "http://localhost:8080/instance/delete/whatsapp-final" \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11"
```

---

## 🔑 Credenciais

- **API Key**: `429683C4C977415CAAFCCE10F7D57E11`
- **URL Base**: `http://localhost:8080`
- **Instância WhatsApp**: `whatsapp-final`
- **Número**: `5551995103563`

---

## 🌐 Acessar Manager Web

```bash
open http://localhost:8080/manager
```

Use a API Key acima para autenticar.

---

## 🔄 Renomear Instância

Se quiser mudar o nome da instância de "whatsapp-final" para outro nome:

### Opção 1: Via SQL (mantém conexão)

```sql
-- Conecte ao banco de dados PostgreSQL e execute:
UPDATE "Instance" SET name = 'novo-nome' WHERE name = 'whatsapp-final';
```

### Opção 2: Criar nova instância

```bash
curl -X POST "http://localhost:8080/instance/create" \
  -H "Content-Type: application/json" \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11" \
  -d '{
    "instanceName": "novo-nome",
    "qrcode": true,
    "integration": "WHATSAPP-BAILEYS"
  }'
```

---

## 🛠️ Troubleshooting

### API não inicia

```bash
# Verifique se a porta 8080 está ocupada
lsof -i :8080

# Se houver processo, mate-o
kill -9 <PID>

# Inicie novamente
cd /Users/jubenitogarcia/Automation/n8n/evolution-api
node dist/main
```

### WhatsApp desconectou

```bash
# Reconecte gerando novo QR Code
curl -X GET "http://localhost:8080/instance/connect/whatsapp-final" \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11"
```

### Atualizar Evolution API

```bash
cd /Users/jubenitogarcia/Automation/n8n/evolution-api
git pull
npm install
npm run build
```

---

## 📚 Documentação

- [Evolution API Oficial](https://doc.evolution-api.com)
- [GitHub Evolution API](https://github.com/EvolutionAPI/evolution-api)
- [n8n Community Node](https://www.npmjs.com/package/n8n-nodes-evolution-api)

---

## ⚠️ Importante

- Sempre mantenha a API rodando quando usar o n8n
- A API Key é sensível - não compartilhe publicamente
- Faça backup regular do banco de dados PostgreSQL
