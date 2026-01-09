# 🎯 Opções de Gatilho - GitHub Actions

Este documento explica todas as formas de acionar o processamento via GitHub Actions.

---

## 📋 Resumo das Opções

| Método | Dificuldade | Uso | Quando Usar |
|--------|-------------|-----|-------------|
| **Interface Web** | ⭐ Fácil | Manual | Poucos processamentos, teste inicial |
| **API (cURL)** | ⭐⭐ Médio | Programático | Integração com sistemas, automação |
| **Script Python** | ⭐⭐ Médio | Programático | Desenvolvimento Python, fácil uso |
| **Webhook Externo** | ⭐⭐⭐ Avançado | Automático | Sistemas enterprise, integração complexa |

---

## 1️⃣ Interface Web (Mais Simples)

### Como Usar

1. Acesse: `https://github.com/SEU_USUARIO/Sprinta-Scraper/actions`
2. Clique no workflow **"Processar Inscrições Sprinta"**
3. Clique em **"Run workflow"**
4. Cole o conteúdo do CSV
5. Clique em **"Run workflow"** novamente

### Vantagens
✅ Não precisa programar
✅ Interface visual
✅ Logs em tempo real

### Desvantagens
❌ Manual (precisa copiar/colar)
❌ Não automatizável
❌ Limitado a arquivos pequenos

### Ideal Para
- Primeiros testes
- Uso esporádico
- Processamentos únicos

---

## 2️⃣ API do GitHub (cURL)

### Como Usar

```bash
# Configurar token
export GITHUB_TOKEN="ghp_seu_token_aqui"
export REPO_OWNER="seu-usuario"
export REPO_NAME="Sprinta-Scraper"

# Preparar CSV
CSV_CONTENT=$(cat participants.csv)

# Enviar requisição
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/dispatches" \
  -d "{
    \"event_type\": \"process-inscricoes\",
    \"client_payload\": {
      \"csv_content\": \"$CSV_CONTENT\"
    }
  }"
```

### Com Base64 (arquivos grandes)

```bash
# Codificar CSV
CSV_BASE64=$(cat participants.csv | base64)

# Enviar
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/dispatches" \
  -d "{
    \"event_type\": \"process-inscricoes\",
    \"client_payload\": {
      \"csv_base64\": \"$CSV_BASE64\"
    }
  }"
```

### Com Callback (receber resultado)

```bash
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/dispatches" \
  -d "{
    \"event_type\": \"process-inscricoes\",
    \"client_payload\": {
      \"csv_content\": \"$CSV_CONTENT\",
      \"callback_url\": \"https://seu-sistema.com/api/results\"
    }
  }"
```

### Vantagens
✅ Totalmente automatizável
✅ Integração com qualquer sistema
✅ Suporta callbacks

### Desvantagens
❌ Precisa configurar token
❌ Mais complexo
❌ Precisa tratar respostas

### Ideal Para
- Scripts bash
- Integração com CI/CD
- Sistemas Unix/Linux

---

## 3️⃣ Script Python (Recomendado)

### Como Usar

```bash
# Configurar .env
cp .env.example .env
nano .env  # Editar com suas credenciais

# Executar
python trigger_github_action.py participants.csv
```

### Conteúdo do .env

```env
GITHUB_TOKEN=ghp_seu_token_aqui
REPO_OWNER=seu-usuario-github
REPO_NAME=Sprinta-Scraper
CALLBACK_URL=https://seu-sistema.com/api/results  # Opcional
```

### Saída do Script

```
╔═══════════════════════════════════════════════════════════════╗
║          🏃‍♂️ Sprinta Scraper - GitHub Actions Trigger        ║
╚═══════════════════════════════════════════════════════════════╝

📄 Lendo arquivo: participants.csv
👥 Participantes encontrados: 50
⏱️  Tempo estimado: ~6.7 minutos

============================================================
🚀 Enviando requisição para GitHub Actions...
   Repositório: seu-usuario/Sprinta-Scraper
✅ Processamento iniciado com sucesso!

📍 Acompanhe em: https://github.com/seu-usuario/Sprinta-Scraper/actions
💡 Os resultados estarão disponíveis nos artifacts da action
============================================================
```

### Vantagens
✅ Muito fácil de usar
✅ Interface amigável
✅ Estimativas de tempo
✅ Validações automáticas

### Desvantagens
❌ Precisa Python instalado
❌ Dependências extras (requests, python-dotenv)

### Ideal Para
- Desenvolvimento Python
- Uso frequente
- Integração com aplicações Python

---

## 4️⃣ Webhook Externo (Avançado)

### Arquitetura

```
Sistema Externo → API Gateway → GitHub Actions → Webhook Callback
                                      ↓
                              Processa CSV
                                      ↓
                              Gera URLs
                                      ↓
                              POST para callback_url
```

### Fluxo Completo

#### Passo 1: Sistema Externo Envia Requisição

```python
import requests

# Seu sistema prepara os dados
participants = get_participants_from_database()
csv_content = convert_to_csv(participants)

# Envia para GitHub Actions
response = requests.post(
    "https://api.github.com/repos/seu-usuario/Sprinta-Scraper/dispatches",
    headers={
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {github_token}",
        "X-GitHub-Api-Version": "2022-11-28"
    },
    json={
        "event_type": "process-inscricoes",
        "client_payload": {
            "csv_content": csv_content,
            "callback_url": "https://seu-sistema.com/api/sprinta-results",
            "request_id": "unique-request-id-123"  # Para rastreamento
        }
    }
)

if response.status_code == 204:
    print("✅ Processamento iniciado!")
    # Salvar no banco: status = "processing"
    save_processing_status("unique-request-id-123", "processing")
```

#### Passo 2: GitHub Actions Processa

```yaml
# Workflow roda automaticamente
# Processa CSV, gera URLs, envia callback
```

#### Passo 3: Receber Resultado no Seu Sistema

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/api/sprinta-results', methods=['POST'])
def receive_sprinta_results():
    results = request.json

    # Processar resultados
    for item in results:
        email = item['email']
        checkout_url = item['checkout_url']

        # Salvar no banco de dados
        save_checkout_url(email, checkout_url)

        # Enviar e-mail para participante
        send_email_with_checkout_link(email, checkout_url)

        # Atualizar CRM
        update_crm(email, {"checkout_url": checkout_url})

    # Atualizar status
    save_processing_status("unique-request-id-123", "completed")

    return jsonify({"status": "success", "processed": len(results)}), 200

if __name__ == '__main__':
    app.run(port=5000)
```

### Validar Callback (Segurança)

```python
import hmac
import hashlib

@app.route('/api/sprinta-results', methods=['POST'])
def receive_sprinta_results():
    # Validar secret token
    secret_token = os.environ.get('WEBHOOK_SECRET')
    received_token = request.headers.get('X-Secret-Token')

    if not hmac.compare_digest(secret_token, received_token):
        return jsonify({"error": "Unauthorized"}), 403

    # Processar resultados...
    results = request.json
    # ...
```

### Vantagens
✅ Totalmente automático
✅ Integração perfeita
✅ Escalável
✅ Assíncrono

### Desvantagens
❌ Complexo de configurar
❌ Precisa endpoint público
❌ Gerenciar segurança

### Ideal Para
- Sistemas enterprise
- SaaS integrations
- Processamento em larga escala
- Automação completa

---

## 🔄 Diagrama de Fluxo Completo

```
┌─────────────────┐
│  Usuário/Sistema│
└────────┬────────┘
         │
         ├─── Opção 1: Interface Web
         │    └→ GitHub UI → Workflow
         │
         ├─── Opção 2: cURL
         │    └→ API GitHub → Workflow
         │
         ├─── Opção 3: Script Python
         │    └→ trigger_github_action.py → API GitHub → Workflow
         │
         └─── Opção 4: Webhook
              └→ Sistema Externo → API GitHub → Workflow → Callback
```

---

## 📊 Comparação de Performance

| Método | Setup Time | Execution Time | Latência |
|--------|-----------|----------------|----------|
| Interface Web | 0 min | ~8s/participante | Alta (manual) |
| cURL | 2 min | ~8s/participante | Baixa |
| Script Python | 5 min | ~8s/participante | Baixa |
| Webhook | 30 min | ~8s/participante | Muito Baixa |

---

## 🎯 Escolher o Método Certo

### Use Interface Web se:
- ✅ É seu primeiro teste
- ✅ Processa poucos participantes ocasionalmente
- ✅ Não precisa automatizar

### Use cURL se:
- ✅ Tem experiência com bash/terminal
- ✅ Quer integrar com scripts existentes
- ✅ Trabalha em ambiente Unix/Linux

### Use Script Python se:
- ✅ Usa Python regularmente
- ✅ Quer interface amigável
- ✅ Precisa processar arquivos locais

### Use Webhook se:
- ✅ Tem sistema existente (CRM, ERP, etc)
- ✅ Precisa automação completa
- ✅ Processa muitos participantes
- ✅ Quer integração perfeita

---

## 🔐 Segurança

### Tokens GitHub
- ⚠️ **NUNCA** commite tokens no código
- ✅ Use variáveis de ambiente
- ✅ Use secrets do GitHub
- ✅ Revogue tokens não utilizados

### Callbacks
- ⚠️ **SEMPRE** valide origem
- ✅ Use HTTPS
- ✅ Implemente secret tokens
- ✅ Rate limiting

### CSV
- ⚠️ Dados sensíveis (CPF, e-mail)
- ✅ Não commite CSV com dados reais
- ✅ Use .gitignore
- ✅ Criptografe em trânsito

---

## 🚀 Próximos Passos

1. **Teste** interface web primeiro
2. **Configure** script Python para uso regular
3. **Implemente** webhook se necessário
4. **Monitore** execuções em GitHub Actions
5. **Otimize** baseado no uso real

---

## 📚 Referências

- [GitHub API - Repository Dispatch](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)
- [GitHub Actions - Manual Workflows](https://docs.github.com/en/actions/using-workflows/manually-running-a-workflow)
- [API_USAGE.md](API_USAGE.md) - Guia detalhado da API
- [QUICKSTART.md](QUICKSTART.md) - Guia de início rápido
