# 🎯 Webhook Server - Guia Completo

Sistema de webhook para acionar automaticamente a GitHub Action quando receber um CSV.

---

## 📋 Arquitetura

```
Sistema Externo → POST CSV → Webhook Server → GitHub API → GitHub Actions
                                    ↓
                            Valida & Processa
                                    ↓
                          Retorna Status (202)
                                    ↓
                          GitHub Actions executa
                                    ↓
                      Webhook Callback (opcional)
                                    ↓
                        Processa resultados
```

---

## 🚀 Setup Rápido

### 1. Instalar Dependências

```bash
pip install flask requests python-dotenv
```

### 2. Configurar Variáveis de Ambiente

Edite o arquivo `.env`:

```bash
# GitHub Configuration
GITHUB_TOKEN=ghp_seu_token_aqui
GITHUB_REPO_OWNER=jubenitogarcia
GITHUB_REPO_NAME=Sprinta-Scraper

# Webhook Security
WEBHOOK_SECRET=seu-secret-token-aqui

# Callback URL (opcional)
CALLBACK_URL=https://seu-sistema.com/api/results
```

### 3. Iniciar Servidor

```bash
python webhook_server.py
```

Servidor rodará em: `http://localhost:5000`

---

## 📡 Endpoints

### 1. Health Check

```bash
GET http://localhost:5000/health
```

**Resposta:**
```json
{
  "status": "healthy",
  "service": "Sprinta Webhook Server",
  "github_token_configured": true
}
```

### 2. Webhook Principal (Receber CSV)

```bash
POST http://localhost:5000/webhook/sprinta
```

**Headers:**
```
X-Secret-Token: seu-secret-token-aqui
X-Callback-URL: https://seu-sistema.com/api/results (opcional)
```

**Opção A - Enviar arquivo CSV:**
```bash
curl -X POST http://localhost:5000/webhook/sprinta \
  -H "X-Secret-Token: seu-secret-token" \
  -F "file=@participants.csv"
```

**Opção B - Enviar JSON:**
```bash
curl -X POST http://localhost:5000/webhook/sprinta \
  -H "X-Secret-Token: seu-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "csv_content": "name;email;phone;cpf;bday;gender;shirt_size;team\nJoão Silva;joao@example.com;51999990000;02443423000;01/01/1985;m;G;Equipe Alpha"
  }'
```

**Resposta (202 Accepted):**
```json
{
  "status": "success",
  "message": "GitHub Action acionada com sucesso",
  "participants": 1,
  "estimated_time_seconds": 8,
  "actions_url": "https://github.com/jubenitogarcia/Sprinta-Scraper/actions"
}
```

### 3. Webhook Callback (Receber Resultados)

```bash
POST http://localhost:5000/webhook/sprinta/callback
```

Este endpoint recebe os resultados da GitHub Action automaticamente.

**Body (enviado pela GitHub Action):**
```json
[
  {
    "email": "joao@example.com",
    "checkout_url": "https://checkout.sprinta.com.br/v27310473..."
  }
]
```

---

## 🧪 Testar Localmente

### Teste 1: Health Check

```bash
curl http://localhost:5000/health
```

### Teste 2: Enviar CSV de Teste

```bash
python webhook_client_test.py
```

### Teste 3: Enviar Arquivo CSV

```bash
python webhook_client_test.py participants.csv
```

---

## 🔒 Segurança

### Token de Autenticação

O webhook valida um secret token em cada requisição:

```python
headers = {
    'X-Secret-Token': 'seu-secret-token'
}
```

Configure um token forte no `.env`:

```bash
WEBHOOK_SECRET=$(openssl rand -hex 32)
```

### HTTPS em Produção

⚠️ **NUNCA use HTTP em produção!**

Use um proxy reverso com SSL:
- Nginx + Let's Encrypt
- Cloudflare
- AWS API Gateway
- Heroku (SSL automático)

---

## 🌐 Deploy em Produção

### Opção 1: Heroku (Mais Simples)

```bash
# Instalar Heroku CLI
brew install heroku

# Login
heroku login

# Criar app
heroku create sprinta-webhook

# Configurar variáveis
heroku config:set GITHUB_TOKEN=ghp_seu_token
heroku config:set WEBHOOK_SECRET=seu-secret

# Deploy
git push heroku main

# Ver logs
heroku logs --tail
```

### Opção 2: AWS EC2

```bash
# Conectar ao servidor
ssh ubuntu@seu-servidor

# Clonar repositório
git clone https://github.com/jubenitogarcia/Sprinta-Scraper.git
cd Sprinta-Scraper

# Instalar dependências
pip install -r requirements.txt

# Configurar .env
nano .env

# Rodar com gunicorn (produção)
pip install gunicorn
gunicorn webhook_server:app -w 4 -b 0.0.0.0:5000
```

### Opção 3: Docker

```bash
# Criar Dockerfile
docker build -t sprinta-webhook .

# Rodar container
docker run -d -p 5000:5000 \
  -e GITHUB_TOKEN=ghp_seu_token \
  -e WEBHOOK_SECRET=seu-secret \
  sprinta-webhook
```

---

## 📊 Exemplo de Integração

### Python

```python
import requests

def inscrever_participantes(csv_file):
    url = "https://seu-webhook.com/webhook/sprinta"
    headers = {
        "X-Secret-Token": "seu-secret-token",
        "X-Callback-URL": "https://seu-sistema.com/callback"
    }

    with open(csv_file, 'rb') as f:
        files = {'file': f}
        response = requests.post(url, files=files, headers=headers)

    if response.status_code == 202:
        print("✅ Processamento iniciado!")
        data = response.json()
        print(f"Participantes: {data['participants']}")
        print(f"Tempo estimado: {data['estimated_time_seconds']}s")
    else:
        print("❌ Erro:", response.json())
```

### Node.js

```javascript
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function inscreverParticipantes(csvFile) {
  const form = new FormData();
  form.append('file', fs.createReadStream(csvFile));

  const response = await axios.post(
    'https://seu-webhook.com/webhook/sprinta',
    form,
    {
      headers: {
        ...form.getHeaders(),
        'X-Secret-Token': 'seu-secret-token',
        'X-Callback-URL': 'https://seu-sistema.com/callback'
      }
    }
  );

  console.log('✅ Processamento iniciado!');
  console.log('Participantes:', response.data.participants);
}
```

### PHP

```php
<?php

function inscreverParticipantes($csvFile) {
    $url = 'https://seu-webhook.com/webhook/sprinta';

    $ch = curl_init();

    $file = new CURLFile($csvFile, 'text/csv', 'participants.csv');
    $data = ['file' => $file];

    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $data);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'X-Secret-Token: seu-secret-token',
        'X-Callback-URL: https://seu-sistema.com/callback'
    ]);

    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($status == 202) {
        echo "✅ Processamento iniciado!\n";
        print_r(json_decode($response));
    } else {
        echo "❌ Erro: $response\n";
    }
}

inscreverParticipantes('participants.csv');
?>
```

---

## 🔄 Fluxo Completo

```
1. Sistema externo → POST CSV → Webhook Server
   ↓
2. Webhook valida secret token
   ↓
3. Webhook aciona GitHub API (repository_dispatch)
   ↓
4. Webhook retorna 202 Accepted
   ↓
5. GitHub Actions inicia processamento
   ↓
6. Selenium processa inscrições (~8s/participante)
   ↓
7. GitHub Actions gera checkout_urls.json
   ↓
8. GitHub Actions envia POST para callback_url
   ↓
9. Webhook callback recebe resultados
   ↓
10. Sistema processa URLs (enviar emails, salvar DB, etc)
```

---

## 📝 Logs

O servidor gera logs detalhados:

```
INFO: Arquivo CSV recebido: participants.csv
INFO: Processando 10 participante(s)
INFO: GitHub Action acionada com sucesso
INFO: Resultados recebidos: 10 participante(s)
INFO:   joao@example.com: https://checkout.sprinta.com.br/v...
```

---

## 🐛 Troubleshooting

### Erro: "GitHub token não configurado"

Configure `GITHUB_TOKEN` no `.env`:
```bash
GITHUB_TOKEN=ghp_seu_token_aqui
```

### Erro: "Token de autorização inválido"

Verifique se o `X-Secret-Token` no header está correto.

### Erro: "Erro ao acionar GitHub Action"

- Verifique se o token tem permissões `repo` e `workflow`
- Confirme que o repositório e owner estão corretos no `.env`

### Webhook não recebe callback

- Verifique se a URL de callback é acessível publicamente
- Use serviços como ngrok para testar localmente:
  ```bash
  ngrok http 5000
  ```

---

## 🎯 Próximos Passos

1. ✅ Rodar webhook localmente
2. ✅ Testar com webhook_client_test.py
3. ✅ Implementar callback para processar resultados
4. ✅ Deploy em produção (Heroku/AWS)
5. ✅ Configurar HTTPS
6. ✅ Integrar com seu sistema

---

## 📚 Documentação Relacionada

- [API_USAGE.md](API_USAGE.md) - Guia completo da API GitHub
- [TRIGGER_OPTIONS.md](TRIGGER_OPTIONS.md) - Todas as formas de acionar
- [README.md](README.md) - Documentação principal
