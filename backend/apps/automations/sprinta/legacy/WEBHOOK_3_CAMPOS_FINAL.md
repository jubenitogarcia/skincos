# ✅ Webhook do Wix - Configuração Final

## 📤 Payload do Webhook (3 Campos)

O webhook envia **exatamente 3 campos** para o Wix:

```json
{
  "submissionId": "inscricao_2025-10-05T12-59-49_idc9200e97_linha3",
  "success": true,
  "redirectUrl": "https://checkout.sprinta.com.br/v27310473LO9CI3lmEnr0PAz"
}
```

### Campos Detalhados

| Campo | Tipo | Origem | Descrição |
|-------|------|--------|-----------|
| `submissionId` | string | Coluna B do CSV **ou** nome do arquivo | ID único da inscrição |
| `success` | boolean | Status da operação | `true` se checkout gerado com sucesso |
| `redirectUrl` | string | URL atual do navegador | URL final do checkout com cupom aplicado |

---

## 🔍 Como o submission_id é Obtido

### Prioridade 1: Coluna B do CSV ✅ (RECOMENDADO)

```csv
DATA,ID,NOME,SOBRENOME,EMAIL,...
2025-10-05,inscricao_2025-10-05_id12345_linha3,Julian,Garcia,julian@email.com,...
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
           Este valor é usado
```

**Código:**
```python
participant.get("submission_id")  # Lê da coluna ID (B)
```

---

### Prioridade 2: Nome do Arquivo CSV ✅ (FALLBACK)

Se a coluna B não tiver valor, o sistema extrai do nome do arquivo:

**Arquivo:**
```
inscricoes/inscricao_2025-10-05T12-59-49_idc9200e97_linha3.csv
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
           Este valor é extraído
```

**Código:**
```python
def extract_submission_id_from_filename(csv_file: str) -> Optional[str]:
    base_name = os.path.basename(csv_file)
    submission_id = os.path.splitext(base_name)[0]

    if submission_id.startswith("inscricao_"):
        return submission_id  # inscricao_2025-10-05T12-59-49_idc9200e97_linha3

    return None
```

**Logs:**
```
ℹ️  submission_id extraído do nome do arquivo: inscricao_2025-10-05T12-59-49_idc9200e97_linha3
```

---

## 🔄 Fluxo Completo

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Google Apps Script                                        │
│    ├─> Gera ID: inscricao_2025-10-05_id12345_linha3        │
│    ├─> Salva na coluna B do Google Sheets                  │
│    └─> Nomeia arquivo: inscricao_..._linha3.csv            │
└─────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. GitHub recebe CSV                                         │
│    inscricoes/inscricao_2025-10-05_id12345_linha3.csv      │
└─────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Python Automation lê submission_id                        │
│    ├─> Tenta ler da coluna B (ID)            ✅ Prioridade 1│
│    └─> Se vazio, extrai do nome do arquivo   ✅ Prioridade 2│
└─────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Processa inscrição no Sprinta                            │
│    └─> Gera checkout_url com cupom aplicado                │
└─────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Envia webhook para Wix                                   │
│    {                                                         │
│      "submissionId": "inscricao_...",  ← Da coluna B ou nome│
│      "success": true,                   ← Sempre true aqui  │
│      "redirectUrl": "https://checkout..." ← URL com cupom   │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 📝 Exemplo Real

### Arquivo CSV Recebido

**Nome do arquivo:**
```
inscricoes/inscricao_2025-10-05T12-59-49_idc9200e97-dd54-4f9c-9642-77395023d844_linha3.csv
```

**Conteúdo:**
```csv
DATA,ID,NOME,SOBRENOME,EMAIL,TELEFONE,CPF,GENERO,CORRIDA,DATA_NASC,TAMANHO
2025-10-05,inscricao_2025-10-05T12-59-49_idc9200e97_linha3,Julian,Garcia,julianbenitogarcia@gmail.com,51999887766,12345678900,Masculino,5K,15/03/1990,G
```

### Processamento

```python
# 1. Lê CSV
participant = {
    "submission_id": "inscricao_2025-10-05T12-59-49_idc9200e97_linha3",  # Da coluna B
    "name": "Julian Garcia",
    "email": "julianbenitogarcia@gmail.com",
    # ... outros campos
}

# 2. Processa inscrição
checkout_url = register_participant(driver, participant)
# checkout_url = "https://checkout.sprinta.com.br/v27310473LO9CI3lmEnr0PAz"

# 3. Envia webhook
send_wix_webhook(
    submission_id="inscricao_2025-10-05T12-59-49_idc9200e97_linha3",
    success=True,
    redirect_url="https://checkout.sprinta.com.br/v27310473LO9CI3lmEnr0PAz",
    webhook_url="https://manage.wix.com/_api/webhook-trigger/..."
)
```

### Payload Enviado

```json
{
  "submissionId": "inscricao_2025-10-05T12-59-49_idc9200e97_linha3",
  "success": true,
  "redirectUrl": "https://checkout.sprinta.com.br/v27310473LO9CI3lmEnr0PAz"
}
```

### Logs no GitHub Actions

```
📋 PROCESSANDO PARTICIPANTE 1: Julian Garcia
📧 ID: inscricao_2025-10-05T12-59-49_idc9200e97_linha3 | Email: julianbenitogarcia@gmail.com
======================================================================
...
🎉 Checkout gerado para julianbenitogarcia@gmail.com: https://checkout.sprinta.com.br/v27310473LO9CI3lmEnr0PAz
✅ Cupom aplicado com sucesso!

📤 Enviando notificação para Wix (ID: inscricao_2025-10-05T12-59-49_idc9200e97_linha3)...

📤 Enviando webhook para Wix...
🔗 URL: https://manage.wix.com/_api/webhook-trigger/...
📦 Payload: {
  "submissionId": "inscricao_2025-10-05T12-59-49_idc9200e97_linha3",
  "success": true,
  "redirectUrl": "https://checkout.sprinta.com.br/v27310473LO9CI3lmEnr0PAz"
}
✅ Webhook enviado com sucesso! Status: 200
```

---

## 🛡️ Fallback: Sem Coluna B

### Cenário

CSV **sem** coluna ID (formato antigo):

```csv
name,email,phone,cpf,bday,gender,shirt_size,team
Julian Garcia,julian@email.com,51999887766,12345678900,15/03/1990,m,G,Equipe A
```

**Arquivo:**
```
inscricoes/inscricao_2025-10-05_teste123.csv
```

### Comportamento

```python
# 1. Tenta ler da coluna B
submission_id = participant.get("submission_id")  # None (não existe)

# 2. Extrai do nome do arquivo
submission_id = extract_submission_id_from_filename(input_file)
# submission_id = "inscricao_2025-10-05_teste123"
```

### Logs

```
ℹ️  submission_id extraído do nome do arquivo: inscricao_2025-10-05_teste123
📤 Enviando notificação para Wix (ID: inscricao_2025-10-05_teste123)...
✅ Webhook enviado com sucesso!
```

---

## ⚙️ Configuração do Google Apps Script

Para garantir que o sistema funcione perfeitamente:

### 1. Nome do Arquivo

```javascript
// Gerar ID único
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
const uuid = Utilities.getUuid().substring(0, 8);
const submissionId = `inscricao_${timestamp}_id${uuid}_linha${lastRow}`;

// Nomear arquivo com o submission_id
const fileName = `inscricoes/${submissionId}.csv`;
```

### 2. Coluna B do CSV

```javascript
// Salvar ID na coluna B do Google Sheets
sheet.getRange(lastRow, 2).setValue(submissionId);

// Incluir no CSV
const headers = 'DATA,ID,NOME,SOBRENOME,EMAIL,...';
const values = `${data},${submissionId},${nome},${sobrenome},...`;
```

---

## 📊 Comparação: Antes vs Depois

| Aspecto | ANTES ❌ | DEPOIS ✅ |
|---------|----------|-----------|
| **Campos do webhook** | submissionId, success, redirectUrl | ✅ Correto |
| **submission_id origem** | Apenas coluna B | Coluna B **ou** nome do arquivo |
| **Fallback** | Nenhum | ✅ Extrai do arquivo |
| **Formato do ID** | Qualquer | `inscricao_*` |
| **Robustez** | Baixa (falha sem coluna B) | ✅ Alta (sempre tem ID) |

---

## 🧪 Testar

### Teste 1: Com Coluna B

```bash
# CSV com coluna ID preenchida
python sprinta_automation.py participants_novo_formato.csv --debug
```

**Resultado esperado:**
```
📧 ID: inscricao_001 | Email: joao@email.com
...
📤 Enviando notificação para Wix (ID: inscricao_001)...
✅ Webhook enviado com sucesso!
```

### Teste 2: Sem Coluna B (Fallback)

```bash
# CSV sem coluna ID, mas arquivo nomeado corretamente
python sprinta_automation.py inscricoes/inscricao_teste_12345.csv --debug
```

**Resultado esperado:**
```
ℹ️  submission_id extraído do nome do arquivo: inscricao_teste_12345
📤 Enviando notificação para Wix (ID: inscricao_teste_12345)...
✅ Webhook enviado com sucesso!
```

---

## 🎯 Resumo

### ✅ O Que Foi Implementado

1. **Webhook envia apenas 3 campos:** `submissionId`, `success`, `redirectUrl`
2. **submission_id** lido da:
   - 🥇 **Prioridade 1:** Coluna B do CSV (campo `ID`)
   - 🥈 **Prioridade 2:** Nome do arquivo CSV (fallback)
3. **Função `extract_submission_id_from_filename()`** para extração do ID
4. **Logs informativos** quando usa fallback

### 📋 Formato Esperado

**Google Apps Script deve:**
- ✅ Gerar ID único no formato `inscricao_*`
- ✅ Salvar na coluna B do Google Sheets
- ✅ Nomear arquivo CSV com o mesmo ID

**Python Automation:**
- ✅ Lê ID da coluna B primeiro
- ✅ Se não houver, extrai do nome do arquivo
- ✅ Envia webhook com 3 campos apenas

---

## 🚀 Status

✅ **Implementado:** Webhook com 3 campos
✅ **Implementado:** Fallback para nome do arquivo
✅ **Testado:** Funciona com e sem coluna B
✅ **Pronto:** Para produção

**Data:** 5 de Outubro de 2025
**Versão:** 2.3 - submission_id do arquivo + webhook simplificado
