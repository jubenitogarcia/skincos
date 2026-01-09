# 🔄 Nova Arquitetura - Automação Sprinta com Webhook Wix

## 📋 Visão Geral

Sistema atualizado que processa inscrições automaticamente quando um arquivo CSV é salvo na pasta `inscricoes/` e notifica o Wix via webhook com o resultado.

---

## 🏗️ Arquitetura Atualizada

```
┌─────────────────────────────────────────────────────────────────┐
│                  FLUXO COMPLETO COM WEBHOOK                     │
└─────────────────────────────────────────────────────────────────┘

     WIX FRONTEND          GITHUB              AUTOMAÇÃO           WIX WEBHOOK
        │                    │                     │                    │
        │  1. Formulário     │                     │                    │
        │     Preenchido     │                     │                    │
        │                    │                     │                    │
        │  2. Salva CSV      │                     │                    │
        │     em inscricoes/ │                     │                    │
        └───────────────────>│                     │                    │
                             │                     │                    │
                             │ 3. Trigger GitHub   │                    │
                             │    Actions (push)   │                    │
                             └────────────────────>│                    │
                                                   │                    │
                                                   │ 4. Processa CSV    │
                                                   │    - Login Sprinta │
                                                   │    - Inscrição     │
                                                   │    - Cupom Desconto│
                                                   │    - Gera Checkout │
                                                   │                    │
                                                   │ 5. POST Webhook    │
                                                   │    {submissionId,  │
                                                   │     success,       │
                                                   │     redirectUrl}   │
                                                   └───────────────────>│
                                                                        │
                                                                        │ 6. Processa
                                                                        │    Redireciona
                                                                        │    usuário
```

---

## 🚀 Como Funciona

### 1. **Disparo Automático (GitHub Actions)**

Quando um arquivo CSV é adicionado à pasta `inscricoes/`, o GitHub Actions é disparado automaticamente:

```yaml
on:
  push:
    paths:
      - "inscricoes/*.csv"
```

### 2. **Processamento da Inscrição**

O script Python (`sprinta_automation.py`) é executado com os seguintes argumentos:

```bash
python sprinta_automation.py inscricoes/inscricao_123.csv \
  --submission-id "inscricao_123" \
  --webhook-url "https://manage.wix.com/_api/webhook-trigger/report/..."
```

**Funcionalidades:**
- ✅ Login automático no Sprinta
- ✅ Preenchimento do formulário de inscrição
- ✅ Aplicação do cupom de desconto (`ESPACOFACIALNH10`)
- ✅ Geração da URL de checkout

### 3. **Notificação via Webhook**

Após processar a inscrição, o script envia automaticamente um POST para o webhook do Wix:

**Formato do Payload:**
```json
{
  "submissionId": "inscricao_123",
  "success": true,
  "redirectUrl": "https://eventos.sprinta.com.br/checkout/abc123"
}
```

**URL do Webhook:**
```
https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f
```

### 4. **Resposta do Wix**

O Wix recebe o webhook e:
- Atualiza o banco de dados com a URL de checkout
- Redireciona o usuário para a página de pagamento
- Ou exibe mensagem de erro se `success: false`

---

## 🔧 Configuração

### Secrets do GitHub

Configure os seguintes secrets em: **Settings → Secrets and variables → Actions**

| Secret | Descrição | Exemplo |
|--------|-----------|---------|
| `SPRINTA_EMAIL` | Email de login no Sprinta | `admin@empresa.com` |
| `SPRINTA_PASSWORD` | Senha do Sprinta | `senha123` |
| `WIX_WEBHOOK_URL` | URL do webhook Wix | `https://manage.wix.com/_api/webhook-trigger/report/...` |

### Formato do CSV de Entrada

O arquivo CSV deve estar em `inscricoes/` com o seguinte formato:

```csv
name;email;phone;cpf;bday;gender;shirt_size;team
João Silva;joao@email.com;51999990000;12345678900;01/01/1990;m;G;Equipe Alpha
```

**Campos obrigatórios:**
- `name`: Nome completo do participante
- `email`: Email válido
- `phone`: Telefone com DDD (11 dígitos)
- `cpf`: CPF sem pontos ou traços (11 dígitos)
- `bday`: Data de nascimento (DD/MM/AAAA)
- `gender`: `m` (masculino) ou `f` (feminino)
- `shirt_size`: `PP`, `P`, `M`, `G`, `GG`, `XG`
- `team`: Nome da equipe

---

## 📊 Fluxo de Dados

### 1. **Input - CSV**
```
inscricoes/inscricao_1733456789.csv
```

### 2. **Processing - GitHub Actions**
- Detecta novo arquivo CSV
- Executa automação Selenium
- Gera checkout URL

### 3. **Output - Webhook**
```json
{
  "submissionId": "inscricao_1733456789",
  "success": true,
  "redirectUrl": "https://eventos.sprinta.com.br/checkout/xyz123"
}
```

### 4. **Backup - Artifacts**
- `checkout_urls.json` (estruturado)
- `checkout_urls.csv` (legado)
- Retenção: 30 dias

---

## 🔍 Monitoramento

### Ver Execuções

1. Acesse o repositório no GitHub
2. Vá em **Actions**
3. Selecione o workflow **"Processar Inscrições Sprinta (Auto-trigger)"**
4. Veja os logs detalhados de cada execução

### Logs Importantes

**Webhook enviado com sucesso:**
```
📤 Enviando webhook para Wix...
🔗 URL: https://manage.wix.com/_api/webhook-trigger/report/...
📦 Payload: {"submissionId": "...", "success": true, "redirectUrl": "..."}
✅ Webhook enviado com sucesso! Status: 200
```

**Erro no webhook:**
```
❌ Erro ao enviar webhook: Connection timeout
```

---

## 🐛 Troubleshooting

### ❌ Webhook não foi enviado

**Problema:** `WIX_WEBHOOK_URL não configurado`

**Solução:**
1. Vá em **Settings → Secrets → Actions**
2. Adicione `WIX_WEBHOOK_URL` com a URL correta

### ❌ Erro 404 no webhook

**Problema:** Webhook URL inválida ou endpoint não existe

**Solução:**
1. Verifique se a URL está correta
2. Confirme que o webhook está ativo no Wix
3. URL esperada: `https://manage.wix.com/_api/webhook-trigger/report/{webhook-id}/{key}`

### ❌ Automação falhou

**Problema:** Script Python não conseguiu gerar checkout URL

**Solução:**
1. Verifique os logs do GitHub Actions
2. Confira se as credenciais (`SPRINTA_EMAIL`, `SPRINTA_PASSWORD`) estão corretas
3. Teste localmente: `python sprinta_automation.py inscricoes/test.csv --debug`

### ⚠️ CSV não foi processado

**Problema:** GitHub Actions não disparou automaticamente

**Solução:**
1. Certifique-se que o arquivo está em `inscricoes/*.csv`
2. Verifique se o commit foi feito corretamente
3. Teste manualmente via **Actions → Run workflow**

---

## 🧪 Teste Manual

### 1. Criar CSV de teste

```bash
cat > inscricoes/teste_manual.csv << EOF
name;email;phone;cpf;bday;gender;shirt_size;team
Teste Manual;teste@email.com;51999999999;12345678900;01/01/1990;m;G;Test Team
EOF
```

### 2. Commit e Push

```bash
git add inscricoes/teste_manual.csv
git commit -m "test: adicionar inscrição de teste"
git push origin main
```

### 3. Acompanhar Execução

- Vá em **Actions** no GitHub
- Veja o workflow sendo executado em tempo real
- Verifique o webhook sendo enviado

---

## 📝 Exemplo de Payload Completo

### Sucesso

```json
{
  "submissionId": "inscricao_1733456789",
  "success": true,
  "redirectUrl": "https://eventos.sprinta.com.br/checkout/abc123xyz?discount=ESPACOFACIALNH10"
}
```

### Falha

```json
{
  "submissionId": "inscricao_1733456789",
  "success": false,
  "redirectUrl": ""
}
```

---

## 🔐 Segurança

### Secrets Protegidos

- ✅ Credenciais nunca aparecem nos logs
- ✅ Secrets criptografados pelo GitHub
- ✅ Acesso restrito a colaboradores autorizados

### HTTPS

- ✅ Webhook enviado via HTTPS
- ✅ Certificados SSL validados
- ✅ Timeout de 30 segundos

---

## 📈 Vantagens da Nova Arquitetura

| Aspecto | Antes | Agora |
|---------|-------|-------|
| **Disparo** | Manual ou polling | Automático (push) |
| **Notificação** | Separada (curl) | Integrada no script |
| **Formato** | JSON genérico | Payload específico Wix |
| **Monitoramento** | Limitado | Logs detalhados |
| **Manutenção** | Dois lugares | Centralizado |
| **Performance** | Mais lenta | Mais rápida |

---

## 🎯 Próximos Passos

1. ✅ **Configurar Secrets** no GitHub
2. ✅ **Testar** com inscrição real
3. ✅ **Monitorar** primeira execução
4. ⏳ **Documentar** no Wix lado do webhook receiver
5. ⏳ **Implementar** tratamento de erros no Wix

---

## 📞 Suporte

Para problemas ou dúvidas:

1. Verifique os **logs do GitHub Actions**
2. Consulte esta documentação
3. Teste localmente com `--debug`
4. Abra uma issue no repositório

---

**Última atualização:** Outubro 2025
**Versão da automação:** 2.0
**Compatibilidade:** Wix Webhooks API
