# 🎉 Atualização Completa - Integração Webhook Wix

## 📅 Data: Outubro 2025
## 🏷️ Versão: 2.0

---

## ✅ O QUE FOI ATUALIZADO

### 1. **sprinta_automation.py** ✨

**Mudanças principais:**

- ✅ Adicionado suporte a **argumentos CLI** (sys.argv)
- ✅ Nova função `send_wix_webhook()` que envia POST para o webhook do Wix
- ✅ Formato de payload específico para Wix:
  ```json
  {
    "submissionId": "inscricao_123",
    "success": true,
    "redirectUrl": "https://checkout.url"
  }
  ```
- ✅ Integração automática: processa CSV → envia webhook → tudo em uma execução

**Novos imports:**
```python
import sys
import argparse
import requests
```

**Uso CLI:**
```bash
python sprinta_automation.py inscricoes/participantes.csv \
  --webhook-url "https://manage.wix.com/_api/webhook-trigger/..." \
  --submission-id "inscricao_123"
```

---

### 2. **GitHub Actions Workflow** 🔄

**Arquivo:** `.github/workflows/process-inscricoes-v2.yml`

**Mudanças:**

- ✅ Removido step separado de webhook (agora integrado no Python)
- ✅ Passa argumentos CLI para o script Python:
  - `--webhook-url` (da secret `WIX_WEBHOOK_URL`)
  - `--submission-id` (nome do arquivo CSV)
- ✅ Simplificado: menos código, mais eficiente
- ✅ Mantém backup automático em Artifacts (30 dias)

**Disparo automático:**
```yaml
on:
  push:
    paths:
      - "inscricoes/*.csv"
```

---

### 3. **Documentação** 📚

**Novos arquivos:**

1. **`NOVA_ARQUITETURA_WEBHOOK.md`**
   - Documentação completa da nova arquitetura
   - Diagramas de fluxo
   - Exemplos de payload
   - Troubleshooting detalhado
   - Guia de configuração passo-a-passo

2. **`README.md` (atualizado)**
   - Destaque para webhook Wix
   - Novos exemplos de uso CLI
   - Link para documentação completa
   - Seção de Secrets atualizada

---

## 🔗 WEBHOOK WIX

### URL do Webhook:
```
https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f
```

### Payload Enviado:

**Sucesso:**
```json
{
  "submissionId": "inscricao_1733456789",
  "success": true,
  "redirectUrl": "https://eventos.sprinta.com.br/checkout/abc123"
}
```

**Falha:**
```json
{
  "submissionId": "inscricao_1733456789",
  "success": false,
  "redirectUrl": ""
}
```

---

## 🚀 COMO USAR AGORA

### Método 1: Automático (RECOMENDADO)

1. Salvar CSV na pasta `inscricoes/`:
```bash
cp participantes.csv inscricoes/inscricao_$(date +%s).csv
```

2. Commit e push:
```bash
git add inscricoes/*.csv
git commit -m "feat: nova inscrição"
git push
```

3. **Pronto!** GitHub Actions:
   - Detecta o arquivo
   - Processa automaticamente
   - Envia webhook para o Wix
   - Cliente é redirecionado

### Método 2: Manual Local

```bash
python sprinta_automation.py inscricoes/teste.csv \
  --webhook-url "https://manage.wix.com/_api/webhook-trigger/..." \
  --submission-id "teste_123"
```

---

## 🔧 CONFIGURAÇÃO NECESSÁRIA

### GitHub Secrets

Configure em: **Settings → Secrets and variables → Actions**

| Secret | Valor | Status |
|--------|-------|--------|
| `SPRINTA_EMAIL` | seu-email@empresa.com | ✅ Configurado |
| `SPRINTA_PASSWORD` | sua-senha | ✅ Configurado |
| `WIX_WEBHOOK_URL` | https://manage.wix.com/_api/... | ⚠️ **CONFIGURAR** |

---

## 📊 FLUXO COMPLETO

```
┌──────────────┐
│ CSV em       │
│ inscricoes/  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ GitHub       │
│ Actions      │
│ (auto)       │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Selenium     │
│ Automation   │
│ - Login      │
│ - Inscrição  │
│ - Cupom      │
│ - Checkout   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Webhook Wix  │
│ POST         │
│ {success,    │
│  redirectUrl}│
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Wix Frontend │
│ Redireciona  │
│ Cliente      │
└──────────────┘
```

---

## ✨ VANTAGENS DA NOVA ARQUITETURA

| Aspecto | Antes | Agora |
|---------|-------|-------|
| **Webhook** | Separado (curl) | Integrado no Python |
| **Payload** | Genérico JSON | Específico Wix |
| **Código** | 2 lugares | 1 lugar (centralizado) |
| **Manutenção** | Duplicado | Simplificado |
| **Logs** | Limitados | Detalhados |
| **Erros** | Manual | Automático via webhook |

---

## 🧪 TESTAR

1. Criar CSV de teste:
```bash
cat > inscricoes/teste_manual.csv << EOF
name;email;phone;cpf;bday;gender;shirt_size;team
Teste Manual;teste@email.com;51999999999;12345678900;01/01/1990;m;G;Test Team
EOF
```

2. Push para GitHub:
```bash
git add inscricoes/teste_manual.csv
git commit -m "test: webhook wix"
git push
```

3. Acompanhar:
- GitHub: **Actions** → Ver logs
- Verificar POST para webhook Wix
- Confirmar resposta 200 OK

---

## 📋 CHECKLIST

- [x] ✅ Script Python atualizado
- [x] ✅ GitHub Actions workflow atualizado
- [x] ✅ Documentação criada
- [x] ✅ README atualizado
- [ ] ⏳ Configurar `WIX_WEBHOOK_URL` secret
- [ ] ⏳ Testar com inscrição real
- [ ] ⏳ Verificar resposta do Wix
- [ ] ⏳ Documentar lado do Wix (receiver)

---

## 🆘 SUPORTE

**Documentação completa:**
- 📖 [NOVA_ARQUITETURA_WEBHOOK.md](NOVA_ARQUITETURA_WEBHOOK.md)
- 📖 [README.md](README.md)

**Troubleshooting:**
- Verificar logs do GitHub Actions
- Testar localmente com `--debug`
- Conferir secrets configurados
- Validar URL do webhook Wix

---

## 📞 PRÓXIMOS PASSOS

1. **Configurar Secret:**
   - Adicionar `WIX_WEBHOOK_URL` nos GitHub Secrets

2. **Testar Integração:**
   - Fazer commit de um CSV de teste
   - Verificar webhook sendo enviado
   - Confirmar resposta do Wix

3. **Documentar Wix:**
   - Como o Wix recebe o webhook
   - Como processa e redireciona
   - Tratamento de erros

4. **Monitorar:**
   - Primeiras execuções reais
   - Performance e tempo de resposta
   - Taxa de sucesso

---

**🎯 Status:** ✅ **ATUALIZAÇÃO COMPLETA**
**👨‍💻 Desenvolvedor:** GitHub Copilot
**📅 Data:** 4 de Outubro de 2025
