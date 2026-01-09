# 🧪 Guia de Teste - Webhook Wix

## 📋 Pré-requisitos

Antes de começar, certifique-se que:
- ✅ Repository clonado localmente
- ✅ Secrets configurados no GitHub:
  - `SPRINTA_EMAIL`
  - `SPRINTA_PASSWORD`
  - `WIX_WEBHOOK_URL`

---

## 🎯 Teste 1: Local (sem webhook)

### Criar CSV de teste

```bash
cat > inscricoes/teste_local.csv << 'EOF'
name;email;phone;cpf;bday;gender;shirt_size;team
João Teste Local;joao.teste@email.com;51999887766;12345678900;15/03/1990;m;G;Equipe Teste
EOF
```

### Executar localmente

```bash
python sprinta_automation.py inscricoes/teste_local.csv --debug
```

**Resultado esperado:**
- ✅ Navegador abre (visível)
- ✅ Login no Sprinta
- ✅ Preenche formulário
- ✅ Gera checkout URL
- ✅ Salva em `checkout_urls.csv` e `checkout_urls.json`

---

## 🎯 Teste 2: Local (com webhook)

### Executar com webhook

```bash
python sprinta_automation.py inscricoes/teste_local.csv \
  --submission-id "teste_local_001" \
  --webhook-url "https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f"
```

**Resultado esperado:**
- ✅ Processa inscrição
- ✅ Exibe logs do webhook:
  ```
  📤 Enviando webhook para Wix...
  🔗 URL: https://manage.wix.com/_api/webhook-trigger/...
  📦 Payload: {
    "submissionId": "teste_local_001",
    "success": true,
    "redirectUrl": "https://eventos.sprinta.com.br/checkout/xyz123"
  }
  ✅ Webhook enviado com sucesso! Status: 200
  ```

---

## 🎯 Teste 3: GitHub Actions (automático)

### Criar e enviar CSV

```bash
# Criar CSV com timestamp único
TIMESTAMP=$(date +%s)
cat > inscricoes/inscricao_${TIMESTAMP}.csv << 'EOF'
name;email;phone;cpf;bday;gender;shirt_size;team
Maria Teste GitHub;maria.teste@email.com;51988776655;98765432100;20/08/1992;f;M;Equipe GitHub
EOF

# Commit e push
git add inscricoes/inscricao_${TIMESTAMP}.csv
git commit -m "test: inscrição automática via GitHub Actions"
git push origin main
```

### Acompanhar execução

1. Acesse: https://github.com/jubenitogarcia/Sprinta-Scraper/actions
2. Veja o workflow **"Processar Inscrições Sprinta (Auto-trigger)"** rodando
3. Clique para ver logs detalhados

**Resultado esperado:**

```
✅ Arquivo encontrado: inscricoes/inscricao_1733456789.csv
🚀 Iniciando processamento...
🔔 Webhook Wix configurado - será notificado automaticamente

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 SPRINTA AUTOMATION v2.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 Arquivo CSV: inscricoes/inscricao_1733456789.csv
💾 Arquivo saída: checkout_urls.csv
🐛 Modo debug: Desativado
🔐 Sessão persistente: Ativada
🔔 Webhook Wix: Configurado
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[... processamento ...]

📤 Enviando webhook para Wix...
🔗 URL: https://manage.wix.com/_api/webhook-trigger/report/...
📦 Payload: {"submissionId": "inscricao_1733456789", "success": true, "redirectUrl": "https://..."}
✅ Webhook enviado com sucesso! Status: 200
📄 Resposta: OK

✅ Processamento finalizado com sucesso!
```

---

## 🎯 Teste 4: GitHub Actions (manual)

### Executar workflow manualmente

1. Vá em: https://github.com/jubenitogarcia/Sprinta-Scraper/actions
2. Clique em **"Processar Inscrições Sprinta (Auto-trigger)"**
3. Clique em **"Run workflow"**
4. Preencha:
   - **Branch:** `main`
   - **Nome do arquivo CSV:** `inscricao_1733456789.csv` (usar um existente)
5. Clique em **"Run workflow"**
6. Acompanhe a execução

---

## 🔍 Verificar Resultados

### 1. Logs do GitHub Actions

**Localizar:**
- GitHub → Actions → Última execução → Ver logs

**O que procurar:**
- ✅ "Webhook enviado com sucesso"
- ✅ Status code: 200
- ✅ Checkout URL gerada

### 2. Artifacts

**Baixar resultados:**
1. GitHub Actions → Execução
2. Scroll até **Artifacts**
3. Download: `checkout-urls-inscricao_XXXX`
4. Descompactar e verificar:
   - `checkout_urls.csv`
   - `checkout_urls.json`

**Conteúdo esperado (JSON):**
```json
{
  "status": "success",
  "timestamp": "2025-10-04T12:34:56Z",
  "total_participants": 1,
  "processed_successfully": 1,
  "failed": 0,
  "results": [
    {
      "email": "maria.teste@email.com",
      "checkout_url": "https://eventos.sprinta.com.br/checkout/xyz123",
      "success": true,
      "discount_applied": "ESPACOFACIALNH10"
    }
  ]
}
```

### 3. Webhook Wix (lado receptor)

**Verificar no Wix:**
- Logs do Web Module
- Console do navegador
- Banco de dados atualizado
- Cliente redirecionado corretamente

---

## 🚨 Troubleshooting

### ❌ Erro: WIX_WEBHOOK_URL não configurado

**Mensagem:**
```
⚠️  WIX_WEBHOOK_URL não configurado - executando sem webhook
```

**Solução:**
```bash
# Configurar secret no GitHub
# Settings → Secrets → Actions → New repository secret
Nome: WIX_WEBHOOK_URL
Valor: https://manage.wix.com/_api/webhook-trigger/report/...
```

### ❌ Erro: 404 no webhook

**Mensagem:**
```
❌ Erro ao enviar webhook: 404 Client Error: Not Found
```

**Possíveis causas:**
1. URL do webhook incorreta
2. Webhook não está ativo no Wix
3. Webhook foi deletado ou desabilitado

**Verificar:**
- URL no secret `WIX_WEBHOOK_URL`
- Status do webhook no painel Wix
- Permissões e configurações do webhook

### ❌ Erro: Connection timeout

**Mensagem:**
```
❌ Erro ao enviar webhook: Connection timeout
```

**Possíveis causas:**
1. Webhook Wix está offline
2. Firewall bloqueando conexão
3. GitHub Actions sem acesso à internet

**Solução:**
- Aguardar e tentar novamente
- Verificar status do Wix
- Testar localmente

### ❌ Erro: 500 Internal Server Error

**Mensagem:**
```
❌ Erro ao enviar webhook: 500 Server Error
```

**Possíveis causas:**
1. Erro no código do webhook receptor (Wix)
2. Payload inválido
3. Banco de dados Wix offline

**Solução:**
- Verificar logs do Wix Web Module
- Validar estrutura do payload
- Testar endpoint manualmente:
  ```bash
  curl -X POST "https://manage.wix.com/_api/webhook-trigger/..." \
    -H "Content-Type: application/json" \
    -d '{"submissionId":"test","success":true,"redirectUrl":"https://test.com"}'
  ```

---

## ✅ Checklist de Validação

Após cada teste, verificar:

- [ ] ✅ CSV foi processado corretamente
- [ ] ✅ Checkout URL foi gerada
- [ ] ✅ Webhook foi enviado (status 200)
- [ ] ✅ Payload está correto (submissionId, success, redirectUrl)
- [ ] ✅ Wix recebeu o webhook
- [ ] ✅ Banco de dados Wix foi atualizado
- [ ] ✅ Cliente foi redirecionado corretamente
- [ ] ✅ Artifacts foram salvos (30 dias)

---

## 📊 Métricas de Sucesso

**Taxa de sucesso esperada:**
- ✅ Processamento CSV: 100%
- ✅ Geração checkout: 95%+
- ✅ Envio webhook: 98%+
- ✅ Resposta Wix 200: 95%+

**Tempo esperado:**
- ⏱️ GitHub Actions setup: 30-60s
- ⏱️ Processamento (1 participante): 8-15s
- ⏱️ Envio webhook: <1s
- ⏱️ **Total:** ~1-2 minutos

---

## 🎓 Exemplo Completo de Teste

```bash
#!/bin/bash
# Script de teste completo

echo "🧪 Iniciando teste completo do webhook Wix"
echo ""

# 1. Criar CSV de teste
TIMESTAMP=$(date +%s)
CSV_FILE="inscricoes/teste_${TIMESTAMP}.csv"

echo "📝 Criando CSV de teste: $CSV_FILE"
cat > "$CSV_FILE" << EOF
name;email;phone;cpf;bday;gender;shirt_size;team
Teste Completo ${TIMESTAMP};teste${TIMESTAMP}@email.com;51999887766;12345678900;01/01/1990;m;G;Equipe Teste
EOF

echo "✅ CSV criado"
echo ""

# 2. Teste local (opcional)
echo "🖥️  Teste local (comentado - descomente para testar)"
# python sprinta_automation.py "$CSV_FILE" --debug
echo ""

# 3. Commit e push para GitHub
echo "📤 Fazendo commit e push..."
git add "$CSV_FILE"
git commit -m "test: webhook wix - $TIMESTAMP"
git push origin main

echo ""
echo "✅ Push concluído!"
echo ""
echo "📊 Acompanhe em: https://github.com/jubenitogarcia/Sprinta-Scraper/actions"
echo ""
echo "🎉 Teste iniciado! Aguarde 2-3 minutos para conclusão."
```

**Executar:**
```bash
chmod +x test_webhook.sh
./test_webhook.sh
```

---

**🎯 Status:** ✅ Pronto para testes
**📅 Última atualização:** 4 de Outubro de 2025
