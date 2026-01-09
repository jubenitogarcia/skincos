# 📋 Formato JSON de Resposta para Wix

## 📊 Visão Geral

A automação Sprinta agora gera uma resposta em formato JSON estruturado, compatível com o endpoint do Wix.

---

## 🎯 Estrutura da Resposta

### Formato Completo

```json
{
  "status": "success",
  "timestamp": "2025-10-03T14:30:45Z",
  "total_participants": 5,
  "processed_successfully": 4,
  "failed": 1,
  "results": [
    {
      "email": "joao@example.com",
      "checkout_url": "https://checkout.sprinta.com.br/807a6ffb-2a85-4a0e-8dee-45195a759372",
      "success": true,
      "discount_applied": "ESPACOFACIALNH10"
    },
    {
      "email": "maria@example.com",
      "checkout_url": "https://checkout.sprinta.com.br/912b7ggc-3b96-5b1f-9eef-56206b860483",
      "success": true,
      "discount_applied": "ESPACOFACIALNH10"
    },
    {
      "email": "pedro@example.com",
      "checkout_url": "",
      "success": false,
      "discount_applied": null
    }
  ]
}
```

---

## 📝 Campos Principais

### 1. Campos de Status Geral

| Campo | Tipo | Descrição | Exemplo |
|-------|------|-----------|---------|
| `status` | `string` | Status da operação (`success` ou `error`) | `"success"` |
| `timestamp` | `dateTime` | Data/hora da execução (ISO 8601 UTC) | `"2025-10-03T14:30:45Z"` |
| `total_participants` | `number` | Total de participantes processados | `5` |
| `processed_successfully` | `number` | Quantidade processada com sucesso | `4` |
| `failed` | `number` | Quantidade que falhou | `1` |

### 2. Array `results`

Lista de resultados individuais por participante:

| Campo | Tipo | Descrição | Exemplo |
|-------|------|-----------|---------|
| `email` | `email_field` | E-mail do participante | `"joao@example.com"` |
| `checkout_url` | `uri_field` | URL de checkout gerada | `"https://checkout.sprinta.com.br/..."` |
| `success` | `boolean_field` | Se o processamento foi bem-sucedido | `true` |
| `discount_applied` | `string` ou `null` | Código do cupom aplicado | `"ESPACOFACIALNH10"` |

---

## 🔄 Exemplos de Resposta

### Sucesso Total (Todos Processados)

```json
{
  "status": "success",
  "timestamp": "2025-10-03T14:30:45Z",
  "total_participants": 3,
  "processed_successfully": 3,
  "failed": 0,
  "results": [
    {
      "email": "participante1@example.com",
      "checkout_url": "https://checkout.sprinta.com.br/abc123",
      "success": true,
      "discount_applied": "ESPACOFACIALNH10"
    },
    {
      "email": "participante2@example.com",
      "checkout_url": "https://checkout.sprinta.com.br/def456",
      "success": true,
      "discount_applied": "ESPACOFACIALNH10"
    },
    {
      "email": "participante3@example.com",
      "checkout_url": "https://checkout.sprinta.com.br/ghi789",
      "success": true,
      "discount_applied": "ESPACOFACIALNH10"
    }
  ]
}
```

### Sucesso Parcial (Alguns Falharam)

```json
{
  "status": "success",
  "timestamp": "2025-10-03T15:45:20Z",
  "total_participants": 4,
  "processed_successfully": 2,
  "failed": 2,
  "results": [
    {
      "email": "sucesso1@example.com",
      "checkout_url": "https://checkout.sprinta.com.br/xyz123",
      "success": true,
      "discount_applied": "ESPACOFACIALNH10"
    },
    {
      "email": "falha1@example.com",
      "checkout_url": "",
      "success": false,
      "discount_applied": null
    },
    {
      "email": "sucesso2@example.com",
      "checkout_url": "https://checkout.sprinta.com.br/uvw456",
      "success": true,
      "discount_applied": "ESPACOFACIALNH10"
    },
    {
      "email": "falha2@example.com",
      "checkout_url": "",
      "success": false,
      "discount_applied": null
    }
  ]
}
```

### Um Único Participante

```json
{
  "status": "success",
  "timestamp": "2025-10-03T16:20:10Z",
  "total_participants": 1,
  "processed_successfully": 1,
  "failed": 0,
  "results": [
    {
      "email": "unico@example.com",
      "checkout_url": "https://checkout.sprinta.com.br/single789",
      "success": true,
      "discount_applied": "ESPACOFACIALNH10"
    }
  ]
}
```

---

## 📂 Arquivos Gerados

A automação gera **dois arquivos** na mesma execução:

### 1. CSV (Compatibilidade)

**Nome:** `checkout_urls.csv`

**Formato:**
```csv
email,checkout_url
joao@example.com,https://checkout.sprinta.com.br/abc123
maria@example.com,https://checkout.sprinta.com.br/def456
```

### 2. JSON (Wix Integration)

**Nome:** `checkout_urls.json`

**Formato:** Estrutura JSON completa (veja exemplos acima)

---

## 🔌 Integração com Wix

### Recebimento no Callback

O webhook pode enviar o JSON para o callback do Wix:

```javascript
// backend/http-functions.js (Wix)
export async function post_receiveResults(request) {
  try {
    const response = await request.body.json();

    console.log('📥 Resposta recebida:', response);

    // Campos disponíveis:
    console.log('Status:', response.status);                    // "success"
    console.log('Timestamp:', response.timestamp);              // "2025-10-03T14:30:45Z"
    console.log('Total:', response.total_participants);         // 5
    console.log('Sucesso:', response.processed_successfully);   // 4
    console.log('Falha:', response.failed);                     // 1

    // Processar cada resultado
    for (const result of response.results) {
      if (result.success) {
        // Atualizar banco de dados com URL
        await wixData.update("Participants", {
          email: result.email,
          checkoutUrl: result.checkout_url,
          discountApplied: result.discount_applied,
          processedAt: new Date(response.timestamp)
        });

        // Enviar e-mail com link
        await sendEmail(result.email, result.checkout_url);
      } else {
        // Registrar falha
        console.error(`❌ Falha para ${result.email}`);
      }
    }

    return ok({ received: true, processed: response.results.length });

  } catch (error) {
    console.error('Erro ao processar resposta:', error);
    return badRequest({ error: error.message });
  }
}
```

---

## 🛠️ Validação do JSON

### Schema TypeScript

```typescript
interface SprintaResponse {
  status: "success" | "error";
  timestamp: string;  // ISO 8601 format: "YYYY-MM-DDTHH:mm:ssZ"
  total_participants: number;
  processed_successfully: number;
  failed: number;
  results: ParticipantResult[];
}

interface ParticipantResult {
  email: string;
  checkout_url: string;
  success: boolean;
  discount_applied: string | null;
}
```

### Validação em JavaScript

```javascript
function validateSprintaResponse(data) {
  // Validar campos obrigatórios
  if (!data.status || !data.timestamp || !data.results) {
    throw new Error('Campos obrigatórios faltando');
  }

  // Validar status
  if (!['success', 'error'].includes(data.status)) {
    throw new Error('Status inválido');
  }

  // Validar timestamp (ISO 8601)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(data.timestamp)) {
    throw new Error('Timestamp inválido');
  }

  // Validar números
  if (typeof data.total_participants !== 'number' ||
      typeof data.processed_successfully !== 'number' ||
      typeof data.failed !== 'number') {
    throw new Error('Campos numéricos inválidos');
  }

  // Validar consistência
  if (data.total_participants !== data.processed_successfully + data.failed) {
    throw new Error('Contagem inconsistente');
  }

  // Validar array results
  if (!Array.isArray(data.results) || data.results.length !== data.total_participants) {
    throw new Error('Array results inválido');
  }

  // Validar cada resultado
  for (const result of data.results) {
    if (!result.email || typeof result.email !== 'string') {
      throw new Error('E-mail inválido');
    }
    if (typeof result.checkout_url !== 'string') {
      throw new Error('checkout_url inválido');
    }
    if (typeof result.success !== 'boolean') {
      throw new Error('success deve ser boolean');
    }
    if (result.discount_applied !== null && typeof result.discount_applied !== 'string') {
      throw new Error('discount_applied inválido');
    }
  }

  return true;
}
```

---

## 📊 Correspondência com Modelo Wix

Mapeamento dos campos do JSON com os tipos esperados pelo Wix:

| Campo Sprinta | Tipo Wix | Exemplo |
|---------------|----------|---------|
| `status` | `string_field` | `"success"` |
| `timestamp` | `dateTime_field` | `"2025-10-03T14:30:45Z"` |
| `total_participants` | `number_field` | `5` |
| `processed_successfully` | `number_field` | `4` |
| `failed` | `number_field` | `1` |
| `results` | `array_field` | `[...]` |
| `results[].email` | `email_field` | `"user@example.com"` |
| `results[].checkout_url` | `uri_field` | `"https://..."` |
| `results[].success` | `boolean_field` | `true` |
| `results[].discount_applied` | `string_field` | `"ESPACOFACIALNH10"` |

---

## 🧪 Testando a Resposta

### Teste Local

```bash
# Executar automação
python sprinta_automation.py

# Verificar JSON gerado
cat checkout_urls.json
```

### Teste com jq (formatação)

```bash
# Formatar JSON
cat checkout_urls.json | jq '.'

# Extrair apenas e-mails de sucesso
cat checkout_urls.json | jq '.results[] | select(.success == true) | .email'

# Contar sucessos e falhas
cat checkout_urls.json | jq '{sucesso: .processed_successfully, falha: .failed}'
```

### Teste de Envio para Wix

```python
# test_wix_callback.py
import json
import requests

# Carregar JSON gerado
with open('checkout_urls.json', 'r') as f:
    data = json.load(f)

# Enviar para callback Wix
callback_url = "https://seu-site.wixsite.com/_functions/receiveResults"
headers = {
    'Content-Type': 'application/json',
    'X-Secret-Token': 'seu-secret-aqui'
}

response = requests.post(callback_url, json=data, headers=headers)
print(f"Status: {response.status_code}")
print(f"Resposta: {response.json()}")
```

---

## 🔄 Workflow GitHub Actions

O workflow também foi atualizado para usar o JSON:

```yaml
- name: Upload Results (JSON)
  uses: actions/upload-artifact@v4
  with:
    name: checkout-urls-json
    path: checkout_urls.json
    retention-days: 7
```

Para baixar o JSON via GitHub Actions:

```bash
# Via GitHub CLI
gh run download <run-id> -n checkout-urls-json

# Ou via interface web
# Actions → Run → Artifacts → checkout-urls-json
```

---

## 📝 Notas Importantes

### Formato de Data/Hora

- ✅ **Correto:** `"2025-10-03T14:30:45Z"` (ISO 8601 UTC)
- ❌ **Incorreto:** `"03/10/2025 14:30:45"` (formato local)

### URLs de Checkout

- ✅ **Sucesso:** URL completa (`"https://checkout.sprinta.com.br/..."`)
- ❌ **Falha:** String vazia (`""`) - **NÃO** `null`

### Cupom Aplicado

- ✅ **Aplicado:** `"ESPACOFACIALNH10"` (string)
- ❌ **Não aplicado:** `null` - **NÃO** string vazia

### Consistência de Dados

```python
# Sempre verificar:
assert total_participants == processed_successfully + failed
assert len(results) == total_participants
assert sum(1 for r in results if r['success']) == processed_successfully
assert sum(1 for r in results if not r['success']) == failed
```

---

## 🚀 Exemplo Completo de Integração

### 1. GitHub Actions executa automação

```
Wix → Webhook → GitHub Actions → sprinta_automation.py
                                         ↓
                              Gera checkout_urls.json
```

### 2. Webhook envia JSON para Wix

```python
# webhook_server.py
@app.route('/webhook/sprinta/callback', methods=['POST'])
def receive_callback():
    data = request.get_json()

    # Validar JSON
    validate_sprinta_response(data)

    # Enviar para Wix
    wix_callback_url = request.headers.get('X-Callback-URL')
    if wix_callback_url:
        requests.post(wix_callback_url, json=data)

    return jsonify({"status": "received"}), 200
```

### 3. Wix processa resultados

```javascript
// Wix recebe JSON e atualiza banco de dados
export async function post_receiveResults(request) {
  const data = await request.body.json();

  for (const result of data.results) {
    if (result.success) {
      // Salvar URL e enviar e-mail
      await processSuccess(result);
    } else {
      // Registrar falha
      await logFailure(result);
    }
  }
}
```

---

## ✅ Checklist de Validação

Antes de ir para produção:

- [ ] JSON gerado corretamente com todos os campos
- [ ] Formato de timestamp válido (ISO 8601 UTC)
- [ ] Contagens corretas (total = sucesso + falha)
- [ ] URLs de checkout válidas (começam com https://)
- [ ] E-mails válidos em todos os resultados
- [ ] Cupom aplicado aparece nos resultados de sucesso
- [ ] Validação no Wix funciona corretamente
- [ ] Teste end-to-end completo (Wix → GitHub → Wix)

---

## 📚 Arquivos Relacionados

- `sprinta_automation.py` - Geração do JSON (linhas 835-855)
- `webhook_server.py` - Recebimento e envio para Wix
- `WIX_INTEGRATION.md` - Integração completa com Wix
- `.github/workflows/process-inscricoes.yml` - Workflow GitHub Actions

---

## 🎉 Resumo

✅ JSON estruturado compatível com Wix
✅ Todos os campos com tipos corretos
✅ Validação de dados implementada
✅ Exemplos completos de uso
✅ Integração end-to-end documentada

**Resultado:** Sistema totalmente integrado do formulário Wix até o banco de dados, com dados estruturados em JSON! 🚀
