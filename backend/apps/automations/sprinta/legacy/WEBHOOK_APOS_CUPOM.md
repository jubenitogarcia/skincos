# 🔔 Webhook Wix - Notificação Após Aplicar Cupom

## 📋 Visão Geral

A automação agora envia automaticamente uma notificação para o webhook do Wix **após aplicar com sucesso o cupom de desconto** na página de checkout. Isso permite que o frontend Wix receba em tempo real o status da inscrição e a URL de pagamento final.

---

## 🔗 Endpoint do Webhook

```
https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f
```

Este endpoint pode ser configurado via variável de ambiente `WIX_WEBHOOK_URL`.

---

## 📤 Payload Enviado

O webhook envia um **POST request** com o seguinte JSON:

```json
{
  "submissionId": "inscricao_12345",
  "success": true,
  "redirectUrl": "https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g"
}
```

### Campos do Payload

| Campo | Tipo | Descrição | Exemplo |
|-------|------|-----------|---------|
| `submissionId` | string | ID único da inscrição (coluna B do CSV) | `"inscricao_12345"` |
| `success` | boolean | Se a operação foi bem sucedida | `true` / `false` |
| `redirectUrl` | string | URL final do checkout com cupom aplicado | `"https://checkout.sprinta.com.br/..."` |

---

## 🔄 Fluxo Completo

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Formulário Wix → Google Sheets → GitHub (CSV)           │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. GitHub Actions detecta novo CSV em inscricoes/          │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Automação Python processa inscrição:                    │
│    - Login no Sprinta                                       │
│    - Preenche formulário                                    │
│    - Obtém URL de checkout                                  │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Aplica cupom ESPACOFACIALNH10 automaticamente           │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. ✅ Envia webhook para Wix                                │
│    POST: {                                                  │
│      submissionId: "inscricao_12345",                       │
│      success: true,                                         │
│      redirectUrl: "https://checkout.sprinta.com.br/..."    │
│    }                                                        │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. Frontend Wix recebe notificação e redireciona usuário   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 Quando o Webhook é Enviado

### ✅ Enviado Quando:

1. **Inscrição bem sucedida** - Checkout URL gerado
2. **Cupom aplicado com sucesso** - Desconto ESPACOFACIALNH10 ativado
3. **Submission ID disponível** - Campo `ID` (coluna B) presente no CSV

### ⚠️ NÃO Enviado Quando:

1. **Sem submission_id** - CSV antigo sem coluna `ID`
2. **Erro na inscrição** - Falha ao gerar checkout
3. **Erro ao aplicar cupom** - Cupom não pode ser aplicado

---

## 🔧 Configuração

### 1. Variável de Ambiente (Recomendado)

Configure no GitHub Secrets ou `.env`:

```bash
WIX_WEBHOOK_URL=https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f
```

### 2. Hardcoded (Padrão)

Se `WIX_WEBHOOK_URL` não estiver definido, usa URL padrão no código.

---

## 📝 Formato do CSV

O CSV **deve incluir** a coluna `ID` (coluna B) para que o webhook seja enviado:

```csv
DATA,ID,NOME,SOBRENOME,EMAIL,TELEFONE,CPF,GENERO,CORRIDA,DATA_NASC,TAMANHO
2025-10-04,inscricao_12345,João,Silva,joao@email.com,51999887766,12345678900,Masculino,5K,15/03/1990,G
```

---

## 🧪 Teste Manual

### Teste com Script Dedicado

```bash
# Teste básico (usa URL padrão e ID de teste)
python test_apply_coupon.py

# Teste com URL específica e ID customizado
python test_apply_coupon.py \
  "https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g" \
  "inscricao_12345"

# Teste completo com webhook customizado
python test_apply_coupon.py \
  "https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g" \
  "inscricao_12345" \
  "https://seu-webhook-customizado.com/endpoint"
```

### Saída Esperada

```
🎟️  APLICAÇÃO DE CUPOM EM CHECKOUT
======================================================================
🔗 URL: https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g
🎫 Cupom: ESPACOFACIALNH10
======================================================================

🌐 Acessando URL do checkout...
✅ Página carregada: Checkout Sprinta
⏸️  [DEBUG] Aguardando página estabilizar...
🔍 Tentando estratégia 1: Buscar input name='discount'...
✅ Campo de cupom encontrado (estratégia 1)!
⏸️  [DEBUG] Preenchendo cupom: ESPACOFACIALNH10
✅ Cupom preenchido no campo
⏸️  [DEBUG] Procurando botão de aplicar...
✅ Botão de aplicar encontrado!
✅ Cupom aplicado!

======================================================================
🎉 CUPOM APLICADO COM SUCESSO!
======================================================================
✅ URL: https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g
✅ Cupom: ESPACOFACIALNH10
======================================================================

📤 Enviando notificação para Wix...

📤 Enviando webhook para Wix...
🔗 URL: https://manage.wix.com/_api/webhook-trigger/report/...
📦 Payload: {
  "submissionId": "inscricao_12345",
  "success": true,
  "redirectUrl": "https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g"
}
✅ Webhook enviado com sucesso! Status: 200
📄 Resposta: {"status":"ok"}
```

---

## 🐛 Troubleshooting

### Problema: Webhook não é enviado

**Causa 1:** CSV sem coluna `ID`
```
⚠️  Aviso: submission_id não disponível. Webhook não será enviado.
```

**Solução:** Use o novo formato de CSV com coluna `ID` (ver `FORMATO_CSV_NOVO.md`)

---

**Causa 2:** Erro na requisição HTTP
```
❌ Erro ao enviar webhook: Connection timeout
```

**Solução:** Verifique conectividade de rede e validade da URL do webhook

---

**Causa 3:** Cupom não foi aplicado
```
⚠️  Não foi possível aplicar cupom: Elemento não encontrado
```

**Solução:** Webhook só é enviado após aplicação bem sucedida do cupom

---

### Problema: Webhook enviado mas Wix não responde

**Verificar:**

1. **URL do webhook está correta?**
   ```bash
   echo $WIX_WEBHOOK_URL
   ```

2. **Webhook está ativo no Wix?**
   - Acesse Wix Dashboard → Automations → Webhooks
   - Verifique se o webhook está habilitado

3. **Payload está no formato correto?**
   - Webhook espera JSON com `submissionId`, `success`, `redirectUrl`

---

## 📊 Logs e Monitoramento

### GitHub Actions Logs

```bash
# Ver logs da última execução
gh run list --limit 1
gh run view <run-id> --log
```

### Logs Locais

```bash
# Executar com logs detalhados
python sprinta_automation.py participants_novo_formato.csv --debug
```

### Estrutura de Log

```
📋 PROCESSANDO PARTICIPANTE 1: João Silva
📧 ID: inscricao_12345 | Email: joao@email.com
======================================================================
🌐 Acessou a página do evento...
✅ Primeiro clique em 'Enroll a friend' realizado.
✅ Segundo clique em 'Enroll a friend' realizado.
...
🎉 Checkout gerado: https://checkout.sprinta.com.br/...
🎟️  [DEBUG] Aplicando cupom de desconto ESPACOFACIALNH10...
✅ Cupom aplicado com sucesso!

📤 Enviando notificação para Wix (ID: inscricao_12345)...
📤 Enviando webhook para Wix...
📦 Payload: {
  "submissionId": "inscricao_12345",
  "success": true,
  "redirectUrl": "https://checkout.sprinta.com.br/..."
}
✅ Webhook enviado com sucesso! Status: 200
```

---

## 🔐 Segurança

### Headers Enviados

```python
headers = {
    "Content-Type": "application/json",
    "User-Agent": "Sprinta-Automation/2.0"
}
```

### Timeout

- **Padrão:** 30 segundos
- Evita travamento se webhook não responder

### Retry Policy

Atualmente **não há retry automático**. Se webhook falhar:
- Erro é logado
- Inscrição é concluída normalmente
- Administrador pode reenviar manualmente se necessário

---

## 🚀 Exemplos de Integração Wix

### JavaScript Backend (Wix)

```javascript
// backend/webhook-receiver.jsw

import wixData from 'wix-data';

export async function post_webhookReceiver(request) {
  const payload = await request.body.json();

  console.log('Webhook recebido:', payload);

  // Atualizar banco de dados Wix
  await wixData.update('Inscricoes', {
    _id: payload.submissionId,
    checkoutUrl: payload.redirectUrl,
    status: payload.success ? 'concluido' : 'erro',
    processedAt: new Date()
  });

  return {
    status: 200,
    body: { status: 'ok', received: true }
  };
}
```

### JavaScript Frontend (Wix)

```javascript
// Pagina de inscrição (pós-pagamento)

import { checkPaymentStatus } from 'backend/webhook-receiver';

$w.onReady(async function () {
  const submissionId = $w('#submissionIdField').value;

  // Aguardar webhook processar
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Buscar URL de checkout atualizada
  const inscricao = await wixData.get('Inscricoes', submissionId);

  if (inscricao.checkoutUrl) {
    // Redirecionar para checkout com cupom aplicado
    wixLocation.to(inscricao.checkoutUrl);
  }
});
```

---

## 📚 Documentação Relacionada

- 📖 [FORMATO_CSV_NOVO.md](FORMATO_CSV_NOVO.md) - Novo formato CSV com coluna ID
- 📖 [GUIA_APLICACAO_CUPOM.md](GUIA_APLICACAO_CUPOM.md) - Aplicação de cupom
- 📖 [NOVA_ARQUITETURA_WEBHOOK.md](NOVA_ARQUITETURA_WEBHOOK.md) - Arquitetura webhook
- 📖 [WIX_INTEGRATION.md](WIX_INTEGRATION.md) - Integração completa Wix

---

## ✅ Checklist de Implementação

- [x] Função `send_wix_webhook()` implementada
- [x] Integração em `apply_coupon_to_checkout_url()`
- [x] Integração em `process_csv()` após registro
- [x] Suporte a variável de ambiente `WIX_WEBHOOK_URL`
- [x] Script de teste atualizado (`test_apply_coupon.py`)
- [x] Logs detalhados de webhook
- [x] Tratamento de erros (não bloqueia inscrição)
- [x] Documentação completa

---

## 🎉 Status

✅ **Implementado e Testado**
📅 **Data:** 4 de Outubro de 2025
🔄 **Versão:** 2.2 - Webhook após aplicar cupom

---

## 🤝 Suporte

Para problemas ou dúvidas:

1. Verifique os logs em modo debug
2. Teste com `test_apply_coupon.py`
3. Consulte documentação relacionada
4. Verifique configuração do webhook no Wix

**Lembre-se:** O webhook é enviado **apenas após** aplicar o cupom com sucesso! 🎟️✅
