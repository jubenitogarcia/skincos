# 🔌 API Usage Guide - Sprinta Scraper

Este guia explica como integrar o Sprinta Scraper com seu sistema externo via API.

## 🎯 Casos de Uso

1. **Sistema Web** → Envia CSV via API → Recebe URLs de checkout
2. **Aplicação Mobile** → Aciona processamento → Recebe notificação
3. **CRM** → Exporta participantes → Automatiza inscrição
4. **Webhook** → Sistema externo notifica → Sprinta processa

---

## 🔐 1. Configurar GitHub Token

Primeiro, crie um Personal Access Token no GitHub:

1. Vá em: https://github.com/settings/tokens
2. Clique em **"Generate new token (classic)"**
3. Selecione os escopos:
   - ✅ `repo` (acesso total ao repositório)
   - ✅ `workflow` (executar workflows)
4. Copie o token gerado (começa com `ghp_...`)

**⚠️ Guarde este token com segurança! Ele não será mostrado novamente.**

---

## 🚀 2. Acionar Processamento via API

### Endpoint

```
POST https://api.github.com/repos/{USUARIO}/{REPO}/dispatches
```

Substitua:
- `{USUARIO}`: Seu usuário do GitHub
- `{REPO}`: Nome do repositório (ex: `Sprinta-Scraper`)

### Headers Obrigatórios

```http
Accept: application/vnd.github+json
Authorization: Bearer ghp_SEU_TOKEN_AQUI
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json
```

---

## 📋 3. Formato da Requisição

### Exemplo Básico (CSV em texto)

```bash
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ghp_SEU_TOKEN_AQUI" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/seu-usuario/Sprinta-Scraper/dispatches \
  -d '{
    "event_type": "process-inscricoes",
    "client_payload": {
      "csv_content": "name;email;phone;cpf;bday;gender;shirt_size;team\nJoão Silva;joao@example.com;51999990000;02443423000;01/01/1985;m;G;Equipe Alpha\nMaria Santos;maria@example.com;51999990001;12345678900;15/02/1990;f;M;Equipe Beta"
    }
  }'
```

### Exemplo com Base64 (arquivos grandes)

```bash
# Codificar CSV em base64
CSV_BASE64=$(cat participants.csv | base64)

curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ghp_SEU_TOKEN_AQUI" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/seu-usuario/Sprinta-Scraper/dispatches \
  -d "{
    \"event_type\": \"process-inscricoes\",
    \"client_payload\": {
      \"csv_base64\": \"$CSV_BASE64\"
    }
  }"
```

### Exemplo com Webhook de Retorno

```bash
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ghp_SEU_TOKEN_AQUI" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/seu-usuario/Sprinta-Scraper/dispatches \
  -d '{
    "event_type": "process-inscricoes",
    "client_payload": {
      "csv_content": "name;email;phone;cpf;bday;gender;shirt_size;team\nJoão Silva;joao@example.com;51999990000;02443423000;01/01/1985;m;G;Equipe Alpha",
      "callback_url": "https://seu-sistema.com/api/sprinta-results"
    }
  }'
```

---

## 📦 4. Parâmetros do Payload

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `event_type` | string | ✅ Sim | Deve ser exatamente: `"process-inscricoes"` |
| `client_payload.csv_content` | string | ⚠️ Um dos dois | Conteúdo do CSV em texto puro |
| `client_payload.csv_base64` | string | ⚠️ Um dos dois | Conteúdo do CSV codificado em base64 |
| `client_payload.callback_url` | string | ❌ Não | URL para receber o resultado via POST |
| `client_payload.issue_number` | number | ❌ Não | Número da issue para comentar resultado |

---

## 📥 5. Receber o Resultado

### Opção A: Via Webhook (callback_url)

Se você forneceu `callback_url`, o GitHub Actions enviará um POST com:

```json
[
  {
    "email": "joao@example.com",
    "checkout_url": "https://checkout.sprinta.com.br/v27310473ilMArua8LX52o6V"
  },
  {
    "email": "maria@example.com",
    "checkout_url": "https://checkout.sprinta.com.br/v27310474abCDefgh12345678"
  }
]
```

### Opção B: Via GitHub Artifacts

1. Vá até a aba **Actions** do repositório
2. Clique no workflow executado
3. Baixe o artifact **"checkout-urls"**
4. Descompacte para obter `checkout_urls.csv` e `checkout_urls.json`

### Opção C: Via GitHub API (polling)

```bash
# Liste as execuções do workflow
curl -H "Authorization: Bearer ghp_SEU_TOKEN" \
  https://api.github.com/repos/seu-usuario/Sprinta-Scraper/actions/runs

# Baixe os artifacts de uma execução específica
curl -H "Authorization: Bearer ghp_SEU_TOKEN" \
  https://api.github.com/repos/seu-usuario/Sprinta-Scraper/actions/runs/{RUN_ID}/artifacts
```

---

## 💻 6. Exemplos em Diferentes Linguagens

### Python

```python
import requests
import base64

# Configuração
GITHUB_TOKEN = "ghp_SEU_TOKEN_AQUI"
REPO_OWNER = "seu-usuario"
REPO_NAME = "Sprinta-Scraper"

# CSV content
csv_content = """name;email;phone;cpf;bday;gender;shirt_size;team
João Silva;joao@example.com;51999990000;02443423000;01/01/1985;m;G;Equipe Alpha
Maria Santos;maria@example.com;51999990001;12345678900;15/02/1990;f;M;Equipe Beta"""

# Enviar para GitHub Actions
url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/dispatches"
headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "X-GitHub-Api-Version": "2022-11-28"
}
payload = {
    "event_type": "process-inscricoes",
    "client_payload": {
        "csv_content": csv_content,
        "callback_url": "https://seu-sistema.com/api/results"
    }
}

response = requests.post(url, headers=headers, json=payload)
print(f"Status: {response.status_code}")
print("✅ Processamento iniciado!" if response.status_code == 204 else "❌ Erro")
```

### Node.js

```javascript
const axios = require('axios');

const GITHUB_TOKEN = 'ghp_SEU_TOKEN_AQUI';
const REPO_OWNER = 'seu-usuario';
const REPO_NAME = 'Sprinta-Scraper';

const csvContent = `name;email;phone;cpf;bday;gender;shirt_size;team
João Silva;joao@example.com;51999990000;02443423000;01/01/1985;m;G;Equipe Alpha`;

async function processarInscricoes() {
  try {
    const response = await axios.post(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`,
      {
        event_type: 'process-inscricoes',
        client_payload: {
          csv_content: csvContent,
          callback_url: 'https://seu-sistema.com/api/results'
        }
      },
      {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    );

    console.log('✅ Processamento iniciado!');
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

processarInscricoes();
```

### PHP

```php
<?php

$github_token = 'ghp_SEU_TOKEN_AQUI';
$repo_owner = 'seu-usuario';
$repo_name = 'Sprinta-Scraper';

$csv_content = "name;email;phone;cpf;bday;gender;shirt_size;team\n";
$csv_content .= "João Silva;joao@example.com;51999990000;02443423000;01/01/1985;m;G;Equipe Alpha";

$data = [
    'event_type' => 'process-inscricoes',
    'client_payload' => [
        'csv_content' => $csv_content,
        'callback_url' => 'https://seu-sistema.com/api/results'
    ]
];

$ch = curl_init("https://api.github.com/repos/$repo_owner/$repo_name/dispatches");
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Accept: application/vnd.github+json',
    "Authorization: Bearer $github_token",
    'X-GitHub-Api-Version: 2022-11-28',
    'Content-Type: application/json'
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo $status === 204 ? "✅ Processamento iniciado!\n" : "❌ Erro: $status\n";
?>
```

---

## 🔄 7. Implementar Webhook Receptor

Exemplo de endpoint para receber os resultados:

### Python (Flask)

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/api/sprinta-results', methods=['POST'])
def receive_results():
    results = request.json

    print("📥 Resultados recebidos:")
    for item in results:
        email = item['email']
        checkout_url = item['checkout_url']
        print(f"  {email}: {checkout_url}")

        # Salvar no banco de dados
        # enviar_email_para_cliente(email, checkout_url)
        # etc...

    return jsonify({"status": "success", "message": "Resultados processados"}), 200

if __name__ == '__main__':
    app.run(port=5000)
```

### Node.js (Express)

```javascript
const express = require('express');
const app = express();

app.use(express.json());

app.post('/api/sprinta-results', (req, res) => {
  const results = req.body;

  console.log('📥 Resultados recebidos:');
  results.forEach(item => {
    console.log(`  ${item.email}: ${item.checkout_url}`);
    // Salvar no banco, enviar e-mail, etc...
  });

  res.json({ status: 'success', message: 'Resultados processados' });
});

app.listen(5000, () => {
  console.log('🚀 Servidor rodando na porta 5000');
});
```

---

## ⏱️ 8. Monitorar Execução

### Via GitHub API

```bash
# Listar workflows em execução
curl -H "Authorization: Bearer ghp_SEU_TOKEN" \
  https://api.github.com/repos/seu-usuario/Sprinta-Scraper/actions/runs?status=in_progress

# Ver detalhes de uma execução
curl -H "Authorization: Bearer ghp_SEU_TOKEN" \
  https://api.github.com/repos/seu-usuario/Sprinta-Scraper/actions/runs/{RUN_ID}
```

### Via Interface Web

1. Acesse: https://github.com/seu-usuario/Sprinta-Scraper/actions
2. Veja o workflow em tempo real
3. Logs completos disponíveis

---

## 🎬 9. Exemplo Completo End-to-End

### Cenário: Sistema web envia CSV e recebe URLs

```python
import requests
import time

# 1. Preparar dados
csv_data = """name;email;phone;cpf;bday;gender;shirt_size;team
João Silva;joao@example.com;51999990000;02443423000;01/01/1985;m;G;Equipe Alpha
Maria Santos;maria@example.com;51999990001;12345678900;15/02/1990;f;M;Equipe Beta"""

# 2. Configurar
GITHUB_TOKEN = "ghp_SEU_TOKEN"
CALLBACK_URL = "https://seu-sistema.com/api/results"

# 3. Enviar para processamento
print("🚀 Iniciando processamento...")
response = requests.post(
    "https://api.github.com/repos/seu-usuario/Sprinta-Scraper/dispatches",
    headers={
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "X-GitHub-Api-Version": "2022-11-28"
    },
    json={
        "event_type": "process-inscricoes",
        "client_payload": {
            "csv_content": csv_data,
            "callback_url": CALLBACK_URL
        }
    }
)

if response.status_code == 204:
    print("✅ Processamento iniciado com sucesso!")
    print("⏳ Aguardando resultados no webhook...")
    print(f"📍 Callback URL: {CALLBACK_URL}")
    print("\n💡 O processamento leva ~8 segundos por participante")
    print("   Para 2 participantes: ~16 segundos")
else:
    print(f"❌ Erro: {response.status_code}")
    print(response.text)
```

---

## 🔒 10. Segurança

### Proteger seu Token

```python
# ❌ NUNCA faça isso:
token = "ghp_123456789abcdef"

# ✅ Use variáveis de ambiente:
import os
token = os.environ.get('GITHUB_TOKEN')

# ✅ Ou arquivo .env:
from dotenv import load_dotenv
load_dotenv()
token = os.environ.get('GITHUB_TOKEN')
```

### Validar Webhook Receptor

```python
from flask import Flask, request, abort

@app.route('/api/sprinta-results', methods=['POST'])
def receive_results():
    # Validar origem
    secret = request.headers.get('X-Secret-Token')
    if secret != os.environ.get('WEBHOOK_SECRET'):
        abort(403)

    results = request.json
    # Processar...
    return jsonify({"status": "success"})
```

---

## 📊 11. Limites e Considerações

| Item | Limite | Nota |
|------|--------|------|
| Tamanho do CSV | ~256 KB | Use base64 para arquivos maiores |
| Tempo máximo (GitHub Actions) | 6 horas | Suficiente para ~2700 participantes |
| Taxa de requisições (API) | 5000/hora | Limite do GitHub para autenticados |
| Concorrência | 1 workflow/vez | Workflows enfileiram automaticamente |

---

## 🐛 12. Troubleshooting

### Erro 404 "Not Found"

- Verifique se o repositório está público ou se o token tem acesso
- Confirme o nome do repositório e usuário

### Erro 401 "Bad Credentials"

- Token expirado ou inválido
- Verifique os escopos do token (`repo` e `workflow`)

### Workflow não inicia

- Verifique se o arquivo `.github/workflows/process-inscricoes.yml` existe
- Confirme que `event_type` é exatamente `"process-inscricoes"`

### Não recebe callback

- Verifique se a URL é acessível publicamente
- Use serviços como webhook.site para testar
- Confira os logs do workflow no GitHub Actions

---

## 📞 13. Suporte

Para dúvidas ou problemas:

1. Verifique os logs no GitHub Actions
2. Abra uma issue no repositório
3. Consulte a documentação do GitHub: https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event

---

## 🎉 Pronto!

Agora você pode integrar o Sprinta Scraper com qualquer sistema externo! 🚀
