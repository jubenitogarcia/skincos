# 🔍 Diagnóstico: Erro 404 no Webhook

## 📋 Resumo do Problema

**Sintoma:**
```
❌ Erro ao enviar webhook: 404 Client Error: Not Found for url: ***
```

**Causa Raiz:**
A secret `WIX_WEBHOOK_URL` **não está configurada** no GitHub Actions.

---

## 🔬 Análise do Log

### ✅ O que está funcionando:

```
✅ Cupom 'ESPACOFACIALNH10' aplicado com sucesso!
🎉 Checkout gerado: https://checkout.sprinta.com.br/v27310473FctPA32SzolNIrs
📤 Enviando webhook para Wix...
📦 Payload: {
  "submissionId": "f3da204f-16f3-4a89-8688-6daaa94f6a06",  ← CORRETO
  "success": true,                                          ← CORRETO
  "redirectUrl": "https://checkout.sprinta.com.br/..."     ← CORRETO
}
```

### ❌ O que está errado:

```
🔗 URL: ***  ← GitHub censura a URL por segurança

❌ Erro ao enviar webhook: 404 Client Error: Not Found
```

**Motivo:** O código está usando a URL **fallback** (linha 1077), mas o GitHub está enviando para uma URL vazia ou incorreta porque a **secret não existe**.

---

## 🔧 Fluxo de Execução Atual

```mermaid
┌─────────────────────────────────────────────────────────────┐
│ 1. GitHub Actions inicia                                    │
│    ├─ Lê variável: WIX_WEBHOOK_URL = ${{ secrets.WIX... }} │
│    └─ Secret não existe ❌                                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Python recebe WIX_WEBHOOK_URL vazia                      │
│    └─ os.environ.get("WIX_WEBHOOK_URL", "fallback_url")    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Usa URL fallback do código                               │
│    └─ "https://manage.wix.com/_api/webhook-trigger/..."    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Envia POST para o webhook                                │
│    └─ requests.post(webhook_url, json=payload)             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Wix responde: 404 Not Found ❌                          │
│    └─ URL pode estar incorreta ou expirada                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 Soluções

### Solução 1: Adicionar Secret no GitHub (RECOMENDADA) ✅

**Passos:**
1. Ir para: https://github.com/jubenitogarcia/Sprinta-Scraper/settings/secrets/actions
2. Clicar em **"New repository secret"**
3. **Name:** `WIX_WEBHOOK_URL`
4. **Value:** `https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f`
5. Salvar

**Vantagens:**
- ✅ Seguro (URL não fica exposta no código)
- ✅ Fácil de atualizar sem mexer no código
- ✅ Funciona automaticamente em todas as execuções

---

### Solução 2: Testar Localmente Primeiro

**Comando:**
```bash
cd /Users/jubenitogarcia/Downloads/Sprinta

# Executar script de teste
python test_webhook_wix.py
```

**O que vai testar:**
- ✅ Se a URL do webhook está correta
- ✅ Se o Wix está respondendo
- ✅ Se o payload está no formato correto
- ✅ Se ambos cenários (sucesso e falha) funcionam

---

### Solução 3: Verificar URL no Wix

**Possíveis problemas:**
- ❌ Token de segurança expirou
- ❌ Webhook foi desabilitado no Wix
- ❌ URL foi alterada/regenerada

**Como verificar:**
1. Acessar Wix Dashboard
2. Ir para **Configurações → Webhooks**
3. Verificar se o webhook está **ativo**
4. Copiar a URL novamente se necessário

---

## 📊 Comparação: Antes vs Depois

### Antes (sem secret):
```yaml
env:
  WIX_WEBHOOK_URL: ${{ secrets.WIX_WEBHOOK_URL }}  ← vazio
```
```python
webhook_url = os.environ.get("WIX_WEBHOOK_URL", "fallback")  ← usa fallback
# URL pode estar desatualizada
```

### Depois (com secret):
```yaml
env:
  WIX_WEBHOOK_URL: ${{ secrets.WIX_WEBHOOK_URL }}  ← valor correto
```
```python
webhook_url = os.environ.get("WIX_WEBHOOK_URL", "fallback")  ← usa secret
# URL sempre atualizada
```

---

## 🧪 Comandos de Teste

### Teste 1: Verificar se o webhook responde
```bash
python test_webhook_wix.py
```

**Resultado esperado:**
```
✅ SUCESSO! Webhook enviado com sucesso!
```

**Se der erro 404:**
- A URL está incorreta ou expirada
- O webhook foi desabilitado no Wix

---

### Teste 2: Testar com curl (alternativa)
```bash
curl -X POST \
  "https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f" \
  -H "Content-Type: application/json" \
  -d '{
    "submissionId": "test-12345",
    "success": true,
    "redirectUrl": "https://checkout.sprinta.com.br/test"
  }'
```

**Resultado esperado:**
- Status 200 ou 202 = ✅ Funcionando
- Status 404 = ❌ URL incorreta
- Status 403 = ❌ Token inválido

---

## 📝 Checklist de Troubleshooting

- [ ] Secret `WIX_WEBHOOK_URL` existe no GitHub?
- [ ] URL do webhook está correta?
- [ ] Webhook está ativo no Wix?
- [ ] Token de segurança não expirou?
- [ ] Firewall/rede não está bloqueando?
- [ ] Formato do payload está correto?

---

## 🎓 Entendendo o Erro 404

**404 Not Found** significa:
> "O servidor não encontrou o recurso solicitado"

**Causas comuns:**
1. URL está **incorreta** (typo, caractere faltando)
2. Webhook foi **deletado** no Wix
3. Token de segurança **expirou**
4. Path da API **mudou** (pouco provável)

---

## 🔗 Links Úteis

- [Documentação do Workflow Otimizado](OTIMIZACAO_GITHUB_ACTIONS.md)
- [Guia de Configuração da Secret](CONFIGURAR_WEBHOOK_SECRET.md)
- [Documentação Completa do Webhook](WEBHOOK_3_CAMPOS_FINAL.md)

---

**Data:** 5 de Outubro de 2025
**Status:** ⏳ Aguardando teste ou configuração da secret
