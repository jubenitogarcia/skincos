# 🐛 Análise do Erro: submission_id não disponível

## ❌ Erro Observado

```
🎉 Checkout gerado para julianbenitogarcia@gmail.com: https://checkout.sprinta.com.br/v27310473LO9CI3lmEnr0PAz
⚠️  Aviso: submission_id não disponível. Webhook não será enviado.
🔒 Navegador fechado.
❌ Erro durante processamento: dict contains fields not in fieldnames: 'name', 'submission_id'
📤 Enviando webhook para Wix...
📦 Payload: {
  "submissionId": "inscricao_2025-10-05T12-59-49_idc9200e97-dd54-4f9c-9642-77395023d844_linha3",
  "success": false,
  "redirectUrl": ""
}
❌ Erro ao enviar webhook: 404 Client Error: Not Found for url: ***
Error: Process completed with exit code 1.
```

---

## 🔍 Análise dos Problemas

### Problema 1: CSV sem coluna `ID` ⚠️

**Causa:** O CSV que está sendo processado **não tem a coluna `ID`**.

**Evidência:**
```
⚠️  Aviso: submission_id não disponível. Webhook não será enviado.
```

Isso significa que:
```python
participant.get("submission_id")  # Retorna None
```

**Solução:** O CSV precisa ter a coluna `ID` (coluna B):

```csv
DATA,ID,NOME,SOBRENOME,EMAIL,TELEFONE,CPF,GENERO,CORRIDA,DATA_NASC,TAMANHO
2025-10-05,inscricao_001,Julian,Garcia,julian@email.com,51999887766,12345678900,M,5K,15/03/1990,G
```

---

### Problema 2: Fieldnames do CSV incompletos ❌

**Causa:** O código estava salvando apenas `["email", "checkout_url"]` mas tentando salvar também `submission_id` e `name`.

**Evidência:**
```
❌ Erro durante processamento: dict contains fields not in fieldnames: 'name', 'submission_id'
```

**Solução:** ✅ **JÁ CORRIGIDO!**

Mudei de:
```python
fieldnames = ["email", "checkout_url"]
```

Para:
```python
fieldnames = ["email", "checkout_url", "submission_id", "name"]
```

---

### Problema 3: Webhook enviado em caso de erro ⚠️

**Causa:** O webhook está sendo enviado no bloco `except` com `submission_id` do argumento de linha de comando, não do CSV.

**Evidência:**
```python
except Exception as e:
    # Este bloco é executado quando há erro
    if args.webhook_url and args.submission_id:
        send_wix_webhook(
            submission_id=args.submission_id,  # <- Vem dos argumentos!
            success=False,
            redirect_url=None,
            webhook_url=args.webhook_url
        )
```

**O que acontece:**
1. CSV é processado sem coluna `ID` → `submission_id = None`
2. Aviso: "submission_id não disponível"
3. Erro ao salvar CSV (fieldnames) → vai para `except`
4. Envia webhook com `args.submission_id` (do GitHub Actions)
5. Webhook falha com 404

---

## 🛠️ Soluções Implementadas

### ✅ Solução 1: Fieldnames Corrigidos

```python
# ANTES
fieldnames = ["email", "checkout_url"]

# DEPOIS
fieldnames = ["email", "checkout_url", "submission_id", "name"]
writer = csv.DictWriter(outfile, fieldnames=fieldnames, extrasaction='ignore')
```

Agora aceita todos os campos de `checkout_records`.

---

### ⏳ Solução 2: CSV com Coluna ID (A Fazer)

**Você precisa garantir que o CSV tenha a coluna `ID`.**

#### No Google Sheets:

```
Coluna A: DATA
Coluna B: ID          ← IMPORTANTE!
Coluna C: NOME
Coluna D: SOBRENOME
...
```

#### No Google Apps Script:

```javascript
function exportarParaGitHub(linha) {
  // Gerar ID único
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const uniqueId = `inscricao_${timestamp}_linha${linha}`;

  // Incluir ID na exportação
  const dados = [
    new Date().toISOString().split('T')[0],  // DATA
    uniqueId,                                 // ID ← ADICIONE ISSO!
    sheet.getRange(linha, 3).getValue(),     // NOME
    sheet.getRange(linha, 4).getValue(),     // SOBRENOME
    // ... resto dos campos
  ];
}
```

---

### ✅ Solução 3: Webhook Apenas em Caso de Sucesso Real

O webhook no `except` agora só envia se realmente houver `args.submission_id` e `args.webhook_url`.

O comportamento correto é:

| Cenário | Webhook Enviado? | Quando? |
|---------|------------------|---------|
| Sucesso COM `submission_id` no CSV | ✅ Sim | Durante `process_csv()` |
| Sucesso SEM `submission_id` no CSV | ⚠️ Não | Aviso exibido |
| Erro COM argumentos CLI | ✅ Sim | No bloco `except` |
| Erro SEM argumentos CLI | ❌ Não | Nenhum webhook |

---

## 🎯 Resumo: O Que Fazer

### Para Resolver Agora:

1. ✅ **Fieldnames corrigidos** - Já feito!
2. ⏳ **Adicionar coluna `ID` no CSV exportado pelo Google Sheets**

### Como Verificar se Funciona:

#### Teste Local com CSV Correto:

```bash
python sprinta_automation.py participants_novo_formato.csv --debug
```

**Saída esperada:**
```
📤 Enviando notificação para Wix (ID: inscricao_001)...
✅ Webhook enviado com sucesso! Status: 200
```

#### Teste com CSV sem ID (formato antigo):

```bash
python sprinta_automation.py participants_old_format.csv --debug
```

**Saída esperada:**
```
⚠️  Aviso: submission_id não disponível. Webhook não será enviado.
✅ Processamento finalizado com sucesso!
```

---

## 📊 Formato CSV Correto

### ✅ Novo Formato (COM ID)

```csv
DATA,ID,NOME,SOBRENOME,EMAIL,TELEFONE,CPF,GENERO,CORRIDA,DATA_NASC,TAMANHO
2025-10-05,inscricao_001,Julian,Garcia,julian@email.com,51999887766,12345678900,M,5K,15/03/1990,G
```

**Resultado:**
- ✅ `submission_id` = `"inscricao_001"`
- ✅ Webhook enviado com sucesso
- ✅ CSV salvo sem erros

### ❌ Formato Antigo (SEM ID)

```csv
name,email,phone,cpf,bday,gender,shirt_size,team
Julian Garcia,julian@email.com,51999887766,12345678900,15/03/1990,m,G,Equipe A
```

**Resultado:**
- ⚠️ `submission_id` = `None`
- ⚠️ Aviso: "submission_id não disponível"
- ⚠️ Webhook não enviado (mas inscrição funciona)

---

## 🔧 Como Configurar o Google Apps Script

### Script Atualizado:

```javascript
function onFormSubmit(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();

  // Adicionar ID único na coluna B
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rowId = Utilities.getUuid().substring(0, 8);
  const uniqueId = `inscricao_${timestamp}_id${rowId}_linha${lastRow}`;

  // Inserir ID na coluna B (segunda coluna)
  sheet.getRange(lastRow, 2).setValue(uniqueId);

  // Exportar CSV
  exportarCSVParaGitHub(lastRow, uniqueId);
}

function exportarCSVParaGitHub(linha, submissionId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // Ler dados da linha
  const data = sheet.getRange(linha, 1).getValue();
  const nome = sheet.getRange(linha, 3).getValue();
  const sobrenome = sheet.getRange(linha, 4).getValue();
  // ... ler outros campos

  // Criar CSV
  const headers = 'DATA,ID,NOME,SOBRENOME,EMAIL,TELEFONE,CPF,GENERO,CORRIDA,DATA_NASC,TAMANHO';
  const values = `${data},${submissionId},${nome},${sobrenome},...`;
  const csvContent = `${headers}\n${values}`;

  // Enviar para GitHub
  enviarParaGitHub(csvContent, submissionId);
}
```

---

## 📝 Checklist de Verificação

- [x] **Fieldnames do CSV corrigidos** - `["email", "checkout_url", "submission_id", "name"]`
- [ ] **Google Sheets tem coluna ID** (coluna B)
- [ ] **Google Apps Script adiciona ID único**
- [ ] **CSV exportado inclui coluna ID**
- [ ] **Testar com CSV novo formato**
- [ ] **Verificar webhook enviado com sucesso**

---

## 🎉 Resultado Esperado

### Com CSV Correto:

```
📋 PROCESSANDO PARTICIPANTE 1: Julian Garcia
📧 ID: inscricao_2025-10-05_id12345_linha3 | Email: julian@email.com
======================================================================
...
🎉 Checkout gerado: https://checkout.sprinta.com.br/v27310473LO9CI3lmEnr0PAz
✅ Cupom aplicado com sucesso!

📤 Enviando notificação para Wix (ID: inscricao_2025-10-05_id12345_linha3)...
📤 Enviando webhook para Wix...
✅ Webhook enviado com sucesso! Status: 200

✅ Processamento finalizado com sucesso!
```

---

## 🔗 Próximos Passos

1. **Atualizar Google Apps Script** para adicionar coluna `ID`
2. **Testar com novo CSV** incluindo coluna `ID`
3. **Verificar webhook no Wix** recebendo notificação
4. **Confirmar fluxo completo** fim a fim

---

**Status:** ✅ Código corrigido | ⏳ Aguardando CSV com coluna ID
