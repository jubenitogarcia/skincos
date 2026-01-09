# 🚀 Quick Reference - Webhook Após Cupom

## 📌 TL;DR

✅ Webhook é enviado **automaticamente** após aplicar cupom ESPACOFACIALNH10
✅ Envia para: `https://manage.wix.com/_api/webhook-trigger/report/...`
✅ Payload: `{ submissionId, success: true, redirectUrl }`
✅ Requer: Coluna `ID` no CSV (coluna B)

---

## ⚡ Comandos Rápidos

### Teste Rápido
```bash
python test_apply_coupon.py
```

### Teste com ID
```bash
python test_apply_coupon.py \
  "https://checkout.sprinta.com.br/vXXXXXX" \
  "inscricao_12345"
```

### Processar CSV
```bash
python sprinta_automation.py participants_novo_formato.csv
```

---

## 📦 Payload

```json
{
  "submissionId": "inscricao_12345",
  "success": true,
  "redirectUrl": "https://checkout.sprinta.com.br/..."
}
```

---

## 📝 CSV Requerido

```csv
DATA,ID,NOME,SOBRENOME,EMAIL,...
2025-10-04,inscricao_001,João,Silva,joao@email.com,...
```

⚠️ **Coluna `ID` é obrigatória!**

---

## 🔧 Configurar Webhook URL

```bash
export WIX_WEBHOOK_URL="https://manage.wix.com/_api/webhook-trigger/report/..."
```

Ou adicione no GitHub Secrets: `WIX_WEBHOOK_URL`

---

## ✅ Quando Enviado

- ✅ Checkout URL gerada
- ✅ Cupom aplicado com sucesso
- ✅ submission_id existe

## ❌ Quando NÃO Enviado

- ❌ CSV sem coluna `ID`
- ❌ Inscrição falhou
- ❌ Cupom não aplicado

---

## 🔍 Verificar Logs

### Sucesso
```
✅ Cupom aplicado com sucesso!
📤 Enviando webhook...
✅ Webhook enviado! Status: 200
```

### Aviso (não bloqueia)
```
⚠️  submission_id não disponível. Webhook não será enviado.
```

---

## 📚 Documentação

| Arquivo | O Que Contém |
|---------|--------------|
| `WEBHOOK_APOS_CUPOM.md` | 📖 Guia completo |
| `RESUMO_WEBHOOK_CUPOM.md` | 📋 Resumo executivo |
| `FLUXOGRAMA_WEBHOOK.md` | 🔄 Fluxograma visual |
| `IMPLEMENTACAO_WEBHOOK_CUPOM.md` | ✅ Checklist implementação |

---

## 🐛 Problemas Comuns

### "submission_id não disponível"
→ Use CSV com coluna `ID` (ver `FORMATO_CSV_NOVO.md`)

### Webhook timeout
→ Normal, não bloqueia inscrição

### Status 4xx/5xx
→ Verifique URL do webhook no Wix

---

## 🎯 Status

✅ **Implementado:** 4/Out/2025
✅ **Testado:** Sim
✅ **Pronto:** Sim

---

## 💡 Dica

> Use `test_apply_coupon.py` para testar webhook rapidamente sem processar CSV inteiro!

---

**Precisa de ajuda?** Veja documentação completa em `WEBHOOK_APOS_CUPOM.md` 📖
