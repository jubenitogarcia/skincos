# 📋 Resumo: Webhook Após Aplicar Cupom

## ✅ O Que Foi Implementado

A automação agora envia **automaticamente** uma notificação HTTP POST para o webhook do Wix **depois de aplicar com sucesso o cupom ESPACOFACIALNH10** na página de checkout.

---

## 🔗 Endpoint do Webhook

```
https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f
```

---

## 📤 Payload Enviado

```json
{
  "submissionId": "inscricao_12345",
  "success": true,
  "redirectUrl": "https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g"
}
```

**Campos:**
- `submissionId` → ID da coluna B do CSV (ex: `inscricao_12345`)
- `success` → `true` se cupom foi aplicado com sucesso
- `redirectUrl` → URL final do checkout com desconto aplicado

---

## 🔄 Quando é Enviado

✅ **SIM** - Após aplicar cupom com sucesso
✅ **SIM** - Se submission_id existe (coluna B do CSV)
✅ **SIM** - Se checkout URL foi gerada

❌ **NÃO** - Se cupom falhar
❌ **NÃO** - Se não houver submission_id
❌ **NÃO** - Se inscrição falhar

---

## 🎯 Fluxo Completo

```
1. CSV com ID (coluna B) → GitHub
2. GitHub Actions → Python Automation
3. Automação faz inscrição → Gera checkout URL
4. Aplica cupom ESPACOFACIALNH10 ✅
5. Envia webhook para Wix 📤
6. Wix recebe notificação → Redireciona usuário
```

---

## 🧪 Como Testar

### Teste Rápido

```bash
python test_apply_coupon.py
```

### Teste com ID Específico

```bash
python test_apply_coupon.py \
  "https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g" \
  "inscricao_12345"
```

---

## 📝 Formato do CSV Necessário

O CSV **precisa ter** a coluna `ID` (coluna B):

```csv
DATA,ID,NOME,SOBRENOME,EMAIL,TELEFONE,CPF,GENERO,CORRIDA,DATA_NASC,TAMANHO
2025-10-04,inscricao_12345,João,Silva,joao@email.com,51999887766,12345678900,M,5K,15/03/1990,G
```

---

## 🔧 Configuração

### Variável de Ambiente (Opcional)

```bash
export WIX_WEBHOOK_URL="https://manage.wix.com/_api/webhook-trigger/report/..."
```

Se não definida, usa a URL padrão hardcoded.

---

## 📊 Saída Esperada

```
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

## ⚠️ Avisos Comuns

### "submission_id não disponível"
**Causa:** CSV não tem coluna `ID`
**Solução:** Use novo formato CSV (ver `FORMATO_CSV_NOVO.md`)

### "Não foi possível enviar webhook"
**Causa:** Erro de rede ou URL inválida
**Solução:** Verifique conectividade e URL do webhook

### "Webhook não será enviado"
**Causa:** Cupom não foi aplicado
**Solução:** Verifique logs de aplicação de cupom

---

## 📚 Documentação Completa

Ver: **WEBHOOK_APOS_CUPOM.md**

---

## ✅ Status

**Implementado:** 4 de Outubro de 2025
**Versão:** 2.2
**Testado:** ✅ Sim

---

## 🎉 Tudo Pronto!

A automação agora notifica o Wix automaticamente após aplicar o cupom com sucesso! 🎟️✅📤
