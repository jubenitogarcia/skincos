# 📦 Webhook Wix - Payload Completo

## 🆕 Versão Atualizada (Outubro 2025)

O webhook agora envia **12 campos completos** com todos os dados do participante.

---

## 📋 Campos do Payload

### Dados Gerados pela Automação (3 campos)

| Campo | Tipo | Descrição | Exemplo |
|-------|------|-----------|---------|
| **submissionId** | string | ID único da submissão (coluna B do CSV ou nome do arquivo) | `"inscricao_001"` |
| **success** | boolean | Indica se a inscrição foi concluída com sucesso | `true` ou `false` |
| **redirectUrl** | string | URL do checkout final com cupom aplicado | `"https://checkout.sprinta.com.br/v27..."` |

---

### Dados do Participante do CSV (9 campos)

| Campo | Tipo | Descrição | Exemplo | Origem CSV |
|-------|------|-----------|---------|------------|
| **nome** | string | Primeiro nome do participante | `"João"` | Coluna C (NOME) |
| **sobrenome** | string | Sobrenome do participante | `"Silva"` | Coluna D (SOBRENOME) |
| **email** | string | Email do participante | `"joao@email.com"` | Coluna E (EMAIL) |
| **telefone** | string | Telefone (apenas números) | `"51999887766"` | Coluna F (TELEFONE) |
| **cpf** | string | CPF (11 dígitos) | `"12345678900"` | Coluna G (CPF) |
| **genero** | string | Gênero do participante | `"Masculino"` ou `"m"` | Coluna H (GENERO) |
| **corrida** | string | Modalidade/Equipe | `"5K"` ou `"Espaço Facial"` | Coluna I (CORRIDA) |
| **dataNascimento** | string | Data de nascimento (DD/MM/AAAA) | `"15/03/1990"` | Coluna J (DATA_NASC) |
| **tamanho** | string | Tamanho da camiseta | `"G"` | Coluna K (TAMANHO) |

---

## 📄 Exemplo de Payload Completo

### Inscrição Bem-Sucedida ✅

```json
{
  "submissionId": "inscricao_2025-10-05T12-59-49_idc9200e97_linha3",
  "success": true,
  "redirectUrl": "https://checkout.sprinta.com.br/v27310473FctPA32SzolNIrs",
  "nome": "João",
  "sobrenome": "Silva",
  "email": "joao@email.com",
  "telefone": "51999887766",
  "cpf": "12345678900",
  "genero": "Masculino",
  "corrida": "5K",
  "dataNascimento": "15/03/1990",
  "tamanho": "G"
}
```

### Inscrição com Falha ❌

```json
{
  "submissionId": "inscricao_2025-10-05T13-15-22_idf3da204f_linha5",
  "success": false,
  "redirectUrl": "",
  "nome": "Maria",
  "sobrenome": "Santos",
  "email": "maria@email.com",
  "telefone": "51988776655",
  "cpf": "98765432100",
  "genero": "Feminino",
  "corrida": "10K",
  "dataNascimento": "20/08/1992",
  "tamanho": "M"
}
```

---

## 🔄 Fluxo de Dados

```mermaid
┌─────────────────────────────────────────────────────────────┐
│ 1. Google Sheets (Formulário Wix)                          │
│    ├─ Usuário preenche formulário                          │
│    └─ Dados salvos nas colunas A-K                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Google Apps Script                                       │
│    ├─ Exporta linha como CSV                               │
│    ├─ Nome: inscricao_[timestamp]_[id]_linha[N].csv       │
│    └─ Commit para GitHub                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. GitHub Actions (Workflow)                                │
│    ├─ Detecta novo CSV                                     │
│    ├─ Executa sprinta_automation.py                        │
│    └─ Variável: WIX_WEBHOOK_URL                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Automação Python (Selenium)                              │
│    ├─ Lê dados do CSV (colunas A-K)                        │
│    ├─ Faz login no Sprinta                                 │
│    ├─ Preenche formulário de inscrição                     │
│    ├─ Aplica cupom ESPACOFACIALNH10                        │
│    ├─ Gera URL de checkout                                 │
│    └─ Prepara payload com 12 campos                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Webhook HTTP POST                                        │
│    ├─ URL: manage.wix.com/_api/webhook-trigger/...         │
│    ├─ Headers: Content-Type: application/json              │
│    └─ Body: JSON com 12 campos                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. Wix recebe webhook                                       │
│    ├─ Processa dados do participante                       │
│    ├─ Atualiza registro no CMS/Database                    │
│    ├─ Envia email com link de pagamento                    │
│    └─ Atualiza status no dashboard                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 Mapeamento CSV → Webhook

### Formato Novo (Google Sheets)

| Coluna CSV | Campo no Webhook | Transformação |
|------------|------------------|---------------|
| A (DATA) | - | Não enviado |
| B (ID) | submissionId | Direto |
| C (NOME) | nome | Direto |
| D (SOBRENOME) | sobrenome | Direto |
| E (EMAIL) | email | Direto |
| F (TELEFONE) | telefone | Direto |
| G (CPF) | cpf | Direto |
| H (GENERO) | genero | Direto |
| I (CORRIDA) | corrida | Direto |
| J (DATA_NASC) | dataNascimento | Direto |
| K (TAMANHO) | tamanho | Direto |
| - | success | **GERADO** pela automação |
| - | redirectUrl | **GERADO** pela automação |

### Formato Antigo (Compatibilidade)

| Coluna CSV | Campo no Webhook | Transformação |
|------------|------------------|---------------|
| name | nome + sobrenome | Split no primeiro espaço |
| email | email | Direto |
| phone | telefone | Direto |
| cpf | cpf | Direto |
| bday | dataNascimento | Direto |
| gender | genero | Direto |
| team | corrida | Direto |
| shirt_size | tamanho | Direto |
| (filename) | submissionId | Extraído do nome do arquivo |
| - | success | **GERADO** pela automação |
| - | redirectUrl | **GERADO** pela automação |

---

## 🧪 Teste do Webhook

### Teste Manual (curl)

```bash
curl -X POST \
  "https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f" \
  -H "Content-Type: application/json" \
  -d '{
    "submissionId": "test-12345",
    "success": true,
    "redirectUrl": "https://checkout.sprinta.com.br/test",
    "nome": "João",
    "sobrenome": "Silva",
    "email": "joao@test.com",
    "telefone": "51999887766",
    "cpf": "12345678900",
    "genero": "Masculino",
    "corrida": "5K",
    "dataNascimento": "15/03/1990",
    "tamanho": "G"
  }'
```

### Teste com Python

```python
import requests
import json

webhook_url = "https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f"

payload = {
    "submissionId": "test-12345",
    "success": True,
    "redirectUrl": "https://checkout.sprinta.com.br/test",
    "nome": "João",
    "sobrenome": "Silva",
    "email": "joao@test.com",
    "telefone": "51999887766",
    "cpf": "12345678900",
    "genero": "Masculino",
    "corrida": "5K",
    "dataNascimento": "15/03/1990",
    "tamanho": "G"
}

response = requests.post(webhook_url, json=payload, headers={"Content-Type": "application/json"})
print(f"Status: {response.status_code}")
print(f"Response: {response.text}")
```

---

## 📊 Vantagens do Payload Completo

### Antes (3 campos):
```json
{
  "submissionId": "...",
  "success": true,
  "redirectUrl": "..."
}
```

**Limitações:**
- ❌ Wix precisava buscar dados em outro lugar
- ❌ Dados podem estar dessincronizados
- ❌ Mais consultas à database

---

### Depois (12 campos):
```json
{
  "submissionId": "...",
  "success": true,
  "redirectUrl": "...",
  "nome": "João",
  "sobrenome": "Silva",
  "email": "joao@email.com",
  "telefone": "51999887766",
  "cpf": "12345678900",
  "genero": "Masculino",
  "corrida": "5K",
  "dataNascimento": "15/03/1990",
  "tamanho": "G"
}
```

**Vantagens:**
- ✅ **Todos os dados em um único payload**
- ✅ **Dados sempre sincronizados** com o momento da inscrição
- ✅ **Menos consultas** ao banco de dados
- ✅ **Facilita email personalizado** (nome, corrida, etc)
- ✅ **Facilita relatórios** e analytics
- ✅ **Melhor auditoria** (todos os dados no log do webhook)

---

## 🔐 Segurança

### O que está sendo enviado:

**Dados Sensíveis:**
- ✅ CPF (necessário para inscrição)
- ✅ Email (necessário para contato)
- ✅ Telefone (necessário para emergência)

**Dados Públicos:**
- ✅ Nome e sobrenome
- ✅ Gênero
- ✅ Corrida/modalidade
- ✅ Tamanho de camiseta
- ✅ Data de nascimento

**Não Sensíveis:**
- ✅ submissionId (ID único gerado)
- ✅ success (boolean)
- ✅ redirectUrl (URL pública de checkout)

### Proteção:

- ✅ **HTTPS**: Comunicação criptografada
- ✅ **Token no URL**: Autenticação via token secreto
- ✅ **Wix Managed**: Webhook gerenciado pelo Wix
- ✅ **LGPD Compliant**: Dados necessários para processamento da inscrição

---

## 🎓 Uso no Wix

### Código Backend (Wix Code)

```javascript
// backend/webhooks.jsw
import wixData from 'wix-data';
import wixCrm from 'wix-crm-backend';

export async function post_checkoutWebhook(request) {
  const payload = await request.body.json();

  // Extrair dados do payload
  const {
    submissionId,
    success,
    redirectUrl,
    nome,
    sobrenome,
    email,
    telefone,
    cpf,
    genero,
    corrida,
    dataNascimento,
    tamanho
  } = payload;

  if (!success) {
    console.error(`Inscrição falhou: ${submissionId}`);
    return { status: 200, body: { message: 'Falha registrada' } };
  }

  // Atualizar registro no CMS
  await wixData.update('Inscricoes', {
    _id: submissionId,
    nome: nome,
    sobrenome: sobrenome,
    email: email,
    telefone: telefone,
    cpf: cpf,
    genero: genero,
    corrida: corrida,
    dataNascimento: dataNascimento,
    tamanho: tamanho,
    checkoutUrl: redirectUrl,
    status: 'checkout_gerado',
    dataProcessamento: new Date()
  });

  // Criar/atualizar contato no CRM
  await wixCrm.createContact({
    name: {
      first: nome,
      last: sobrenome
    },
    emails: [email],
    phones: [telefone]
  });

  // Enviar email com link de pagamento
  await sendCheckoutEmail(email, nome, redirectUrl, corrida);

  return {
    status: 200,
    body: { message: 'Webhook processado com sucesso' }
  };
}

async function sendCheckoutEmail(email, nome, checkoutUrl, corrida) {
  // Implementar envio de email personalizado
  // Usar wix-send-email ou serviço de email marketing
}
```

---

## 📝 Checklist de Implementação

- [ ] Webhook do Wix configurado e testado
- [ ] Secret `WIX_WEBHOOK_URL` adicionada no GitHub
- [ ] Código do Wix atualizado para receber 12 campos
- [ ] Teste com payload completo realizado
- [ ] Email personalizado configurado
- [ ] Dashboard/relatórios atualizados
- [ ] Logs de webhook funcionando
- [ ] Tratamento de erros implementado

---

## 🐛 Troubleshooting

### Erro: "Campo X não encontrado"

**Causa:** CSV está no formato antigo

**Solução:** Automação detecta automaticamente. Campos faltantes serão enviados vazios.

---

### Erro: "nome e sobrenome vazios"

**Causa:** Campo `name` no formato antigo não foi separado corretamente

**Solução:** Automação usa `split(maxsplit=1)` para separar primeiro espaço.

---

### Erro: "submissionId vazio"

**Causa:** Coluna B do CSV está vazia E nome do arquivo não segue padrão

**Solução:**
1. Garantir que coluna B tenha ID único
2. OU nomear arquivo como `inscricao_[timestamp]_[id]_linha[N].csv`

---

## 📚 Documentação Relacionada

- [Webhook 3 Campos Original](WEBHOOK_3_CAMPOS_FINAL.md) - Versão anterior
- [Formato CSV Novo](FORMATO_CSV_NOVO.md) - Estrutura do CSV
- [Google Apps Script](GOOGLE_APPS_SCRIPT_COMPLETO.js) - Script de exportação
- [Configurar Secret](CONFIGURAR_WEBHOOK_SECRET.md) - Setup no GitHub

---

**Data:** 5 de Outubro de 2025
**Versão:** 2.0 - Payload Completo com 12 campos
**Compatibilidade:** ✅ Mantém retrocompatibilidade com formato de 3 campos
