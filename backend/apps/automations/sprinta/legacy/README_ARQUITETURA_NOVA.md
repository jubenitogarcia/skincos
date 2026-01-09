# 🚀 Sprinta Automation - Arquitetura com GitHub Direct

## 📋 Índice
- [Visão Geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Fluxo de Dados](#fluxo-de-dados)
- [Configuração](#configuração)
- [Componentes](#componentes)
- [Vantagens](#vantagens)
- [Como Testar](#como-testar)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Visão Geral

Esta é uma **solução completa** que elimina dependências de servidor local e ngrok. Quando um usuário preenche o formulário no Wix:

1. **Wix** → Cria CSV e commita no GitHub
2. **GitHub Actions** → Detecta automaticamente e processa com Selenium
3. **GitHub** → Salva URL de checkout no repositório
4. **Wix** → Busca resultado e redireciona usuário

**✨ Sem servidor local, sem ngrok, sem complicações!**

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                         FLUXO COMPLETO                          │
└─────────────────────────────────────────────────────────────────┘

     USUÁRIO                    WIX                   GITHUB
        │                        │                       │
        │  1. Preenche          │                       │
        │     Formulário        │                       │
        └──────────────────────>│                       │
                                │                       │
                                │  2. Cria CSV          │
                                │  3. Commit via API    │
                                └──────────────────────>│
                                                        │
                        ┌───────────────────────────────┤
                        │  4. GitHub Actions Trigger    │
                        │     (on push: inscricoes/)    │
                        └───────────────────────────────┤
                                                        │
                        ┌───────────────────────────────┤
                        │  5. Processa Selenium         │
                        │     - Acessa Sprinta          │
                        │     - Aplica cupom            │
                        │     - Gera checkout           │
                        └───────────────────────────────┤
                                                        │
                        ┌───────────────────────────────┤
                        │  6. Commit resultado          │
                        │     (resultados/*.json)       │
                        └───────────────────────────────┤
                                                        │
                                │  7. Polling (3s × 10) │
                                │<──────────────────────┘
                                │
        ┌──────────────────────<│  8. Retorna URL
        │  9. Redirect to       │
        │     Checkout          │
        └──────────────────────>│

```

---

## 📊 Fluxo de Dados

### 1️⃣ **Diretórios do Repositório**

```
Sprinta/
├── inscricoes/           ← CSV de entrada (Wix commita aqui)
│   ├── .gitkeep
│   └── inscricao_TIMESTAMP.csv
│
├── resultados/           ← JSON de saída (Actions commita aqui)
│   ├── .gitkeep
│   └── resultado_TIMESTAMP.json
│
├── .github/workflows/
│   └── process-inscricoes-v2.yml  ← Workflow trigger automático
│
├── sprinta_automation.py          ← Selenium automation
├── WIX_GITHUB_DIRECT.jsw          ← Backend Wix
└── WIX_PAGINA_INSCRICAO.js        ← Frontend Wix
```

### 2️⃣ **Formato dos Dados**

**CSV de Entrada** (`inscricoes/inscricao_TIMESTAMP.csv`):
```csv
name,email,phone,cpf,bday,gender,shirtSize,team
João Silva,joao@email.com,11999999999,12345678900,15/03/1990,m,M,Espaço Facial
```

**JSON de Saída** (`resultados/resultado_TIMESTAMP.json`):
```json
{
  "success": true,
  "checkout_url": "https://sprinta.com.br/checkout/abc123",
  "participant": {
    "name": "João Silva",
    "email": "joao@email.com"
  },
  "processed_at": "2025-06-15T14:30:00Z",
  "discount_applied": "ESPACOFACIALNH10"
}
```

---

## ⚙️ Configuração

### 🔐 **1. GitHub Token (para Wix)**

Você precisa de um token com permissão de **repo** para o Wix commitar arquivos.

```bash
# No GitHub:
# 1. Settings → Developer settings → Personal access tokens → Tokens (classic)
# 2. Generate new token
# 3. Selecione: ✅ repo (full control of private repositories)
# 4. Copie o token: ghp_xxxxxxxxxxxxxxxxxxxxx
```

**⚠️ IMPORTANTE:** Este token é DIFERENTE do token usado nas GitHub Actions (que já está configurado nos Secrets).

### 📝 **2. Configurar Wix Backend**

Abra `WIX_GITHUB_DIRECT.jsw` no Wix Code e substitua:

```javascript
const GITHUB_TOKEN = 'SEU_GITHUB_TOKEN_AQUI';  // ← Token gerado acima
const REPO_OWNER = 'jubenitogarcia';            // ✅ Já configurado
const REPO_NAME = 'Sprinta-Scraper';            // ✅ Já configurado
```

### 🎨 **3. Configurar Wix Frontend**

No Wix Editor:

1. **Adicione elementos à página:**
   - `#nameInput` - Text Input (Nome)
   - `#emailInput` - Text Input (Email)
   - `#phoneInput` - Text Input (Telefone)
   - `#cpfInput` - Text Input (CPF)
   - `#bdayInput` - Date Picker (Data de Nascimento)
   - `#genderDropdown` - Dropdown (Gênero: m/f)
   - `#shirtSizeDropdown` - Dropdown (Tamanho: P/M/G/GG/XG)
   - `#teamInput` - Text Input (Equipe - padrão: "Espaço Facial")
   - `#submitButton` - Button
   - `#loadingIcon` - Image/Icon (opcional)
   - `#statusMessage` - Text (mensagens temporárias)
   - `#successMessage` - Text (sucesso)
   - `#errorMessage` - Text (erros)

2. **Copie o código** de `WIX_PAGINA_INSCRICAO.js` para a página

3. **Configure o banco de dados** (opcional):
   - Crie collection "Participants" com os campos necessários

### ✅ **4. GitHub Actions**

**Já está configurado!** O workflow `process-inscricoes-v2.yml` será acionado automaticamente.

**Secrets necessários** (já configurados):
- `SPRINTA_EMAIL` ✅
- `SPRINTA_PASSWORD` ✅

---

## 🧩 Componentes

### 1️⃣ **WIX_GITHUB_DIRECT.jsw** (Backend Wix)

Funções principais:
- `enviarInscricaoParaGitHub(dados)` - Cria CSV e commita no GitHub
- `aguardarResultado(filename)` - Polling para buscar resultado
- `buscarResultadoNoGitHub(filename)` - Consulta API do GitHub

### 2️⃣ **WIX_PAGINA_INSCRICAO.js** (Frontend Wix)

Responsabilidades:
- Coletar dados do formulário
- Salvar no banco Wix
- Chamar backend para processar
- Redirecionar para checkout

### 3️⃣ **process-inscricoes-v2.yml** (GitHub Actions)

Trigger:
```yaml
on:
  push:
    paths:
      - 'inscricoes/*.csv'
```

Steps:
1. Detecta CSV mais recente
2. Instala dependências Python
3. Executa Selenium automation
4. Commit resultado de volta

### 4️⃣ **sprinta_automation.py** (Selenium)

Features:
- ✅ Chrome headless
- ✅ Auto-aplicação de cupom (10+ estratégias)
- ✅ Output dual: CSV + JSON
- ✅ Tratamento de erros robusto

---

## 🌟 Vantagens

### **vs. Webhook + Ngrok:**

| Aspecto | Webhook/Ngrok | GitHub Direct |
|---------|---------------|---------------|
| **Servidor Local** | ❌ Necessário | ✅ Não precisa |
| **Ngrok Tunnel** | ❌ URL muda | ✅ Não precisa |
| **Máquina Online** | ❌ 24/7 | ✅ GitHub cuida |
| **Confiabilidade** | ⚠️ Média | ✅ Alta |
| **Histórico** | ❌ Logs locais | ✅ Git history |
| **Escalabilidade** | ⚠️ Limitada | ✅ GitHub Actions |
| **Manutenção** | ❌ Manual | ✅ Automática |
| **Custo** | 💰 Ngrok pago | ✅ GitHub grátis* |

*GitHub Actions: 2000 min/mês grátis para repositórios privados

---

## 🧪 Como Testar

### **Teste 1: Workflow Manual**

```bash
cd /Users/jubenitogarcia/Downloads/Sprinta

# 1. Criar CSV de teste
cat > inscricoes/inscricao_test_$(date +%s).csv << 'EOF'
name,email,phone,cpf,bday,gender,shirtSize,team
João Teste,joao.teste@email.com,11999999999,12345678900,15/03/1990,m,M,Espaço Facial
EOF

# 2. Commit e push
git add inscricoes/
git commit -m "test: inscrição manual para testar workflow"
git push origin main

# 3. Acompanhar no GitHub
echo "🔍 Abra: https://github.com/jubenitogarcia/Sprinta-Scraper/actions"
```

**Espere 2-3 minutos** e verifique:
- ✅ Workflow executado com sucesso
- ✅ Arquivo `resultados/resultado_*.json` criado
- ✅ URL de checkout válida

### **Teste 2: Via Wix**

1. Publique o site Wix
2. Preencha o formulário
3. Observe console do navegador:
   - `📋 Dados coletados`
   - `💾 Salvo no Wix`
   - `🔄 Commit criado no GitHub`
   - `⏳ Aguardando processamento...`
   - `✅ Checkout URL recebida`
   - `🔄 Redirecionando...`

---

## 🔧 Troubleshooting

### ❌ **"Could not get contents"**

**Problema:** Token sem permissão ou expirado

**Solução:**
```javascript
// Verifique em WIX_GITHUB_DIRECT.jsw:
const GITHUB_TOKEN = 'ghp_xxxxxxxxxxxxxxxxxxxxx';  // Token correto?

// Teste o token:
curl -H "Authorization: token SEU_TOKEN" \
  https://api.github.com/user
```

### ❌ **"Arquivo não encontrado após 30 segundos"**

**Problema:** Workflow não executou ou falhou

**Soluções:**
1. Verifique Actions: `https://github.com/jubenitogarcia/Sprinta-Scraper/actions`
2. Veja os logs do workflow
3. Verifique se Secrets estão configurados (SPRINTA_EMAIL, SPRINTA_PASSWORD)

### ❌ **Workflow não dispara**

**Problema:** Arquivo não está em `inscricoes/*.csv`

**Solução:**
```bash
# Certifique-se que está commitando no caminho correto:
git add inscricoes/inscricao_*.csv
git commit -m "nova inscrição"
git push origin main
```

### ❌ **Selenium falha**

**Problema:** Sprinta mudou layout ou erros de rede

**Soluções:**
1. Veja logs detalhados no Actions
2. Teste localmente:
   ```bash
   python sprinta_automation.py inscricoes/inscricao_test.csv
   ```
3. Verifique se cupom `ESPACOFACIALNH10` ainda é válido

---

## 📚 Documentação Adicional

- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [GitHub API - Contents](https://docs.github.com/en/rest/repos/contents)
- [Wix Code - Backend](https://www.wix.com/velo/reference/api-overview/introduction)
- [Selenium Python](https://selenium-python.readthedocs.io/)

---

## 🎉 Próximos Passos

1. ✅ Commit novos arquivos para GitHub
2. ✅ Configurar token no Wix
3. ✅ Testar workflow manual
4. ✅ Testar via formulário Wix
5. ✅ Monitorar primeiras inscrições reais
6. 📝 Documentar edge cases
7. 🚀 Deploy em produção!

---

**Criado por:** Jubênito Garcia
**Repositório:** [jubenitogarcia/Sprinta-Scraper](https://github.com/jubenitogarcia/Sprinta-Scraper)
**Data:** Junho 2025
