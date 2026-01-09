# 🚀 Guia Rápido de Início - Sprinta Scraper

Este guia mostrará como configurar e usar o Sprinta Scraper em 5 minutos.

---

## 📦 Opção 1: Executar Localmente (Mais Simples)

### 1. Instalar Dependências

```bash
pip install -r requirements.txt
```

### 2. Preparar CSV

Crie ou edite `participants.csv`:

```csv
name;email;phone;cpf;bday;gender;shirt_size;team
João Silva;joao@example.com;51999990000;02443423000;01/01/1985;m;G;Equipe Alpha
```

### 3. Executar

```bash
python sprinta_automation.py
```

**Pronto!** O arquivo `checkout_urls.csv` será gerado com as URLs de pagamento.

---

## ☁️ Opção 2: Usar GitHub Actions (Processamento na Nuvem)

### 1. Criar Repositório no GitHub

```bash
./setup_github_repo.sh
```

O script irá:
- ✅ Criar repositório no GitHub
- ✅ Fazer push do código
- ✅ Configurar Git automaticamente

### 2. Configurar Secrets

1. Acesse: `Settings` → `Secrets and variables` → `Actions`
2. Clique em **"New repository secret"**
3. Adicione:
   - Nome: `SPRINTA_EMAIL` | Valor: `seu-email@empresa.com`
   - Nome: `SPRINTA_PASSWORD` | Valor: `sua-senha`

### 3. Executar via Interface Web

1. Acesse a aba **Actions** do seu repositório
2. Selecione **"Processar Inscrições Sprinta"**
3. Clique em **"Run workflow"**
4. Cole o conteúdo do CSV no campo
5. Clique em **"Run workflow"** novamente
6. Aguarde o processamento (~8s por participante)
7. Baixe os resultados em **Artifacts** → **checkout-urls**

### 4. Ou Executar via API

Configure o arquivo `.env`:

```bash
cp .env.example .env
nano .env  # Edite com suas credenciais
```

Execute:

```bash
python trigger_github_action.py participants.csv
```

---

## 🔑 Obter GitHub Token (para API)

1. Acesse: https://github.com/settings/tokens
2. Clique em **"Generate new token (classic)"**
3. Marque os escopos:
   - ✅ `repo`
   - ✅ `workflow`
4. Clique em **"Generate token"**
5. Copie o token (começa com `ghp_...`)
6. Adicione ao `.env`: `GITHUB_TOKEN=ghp_seu_token_aqui`

---

## 📊 Tabela de Comparação

| Método | Vantagens | Desvantagens |
|--------|-----------|--------------|
| **Local** | • Mais rápido para poucos participantes<br>• Não precisa configurar GitHub<br>• Vê o navegador em ação | • Precisa ter Chrome e Python instalados<br>• Usa recursos do seu computador<br>• Precisa deixar rodando |
| **GitHub Actions** | • Roda na nuvem (não usa seu PC)<br>• Pode acionar remotamente via API<br>• Integração com sistemas externos<br>• Logs permanentes | • Precisa configurar secrets<br>• Primeira vez demora um pouco mais<br>• Limite de 6 horas por execução |

---

## ⚡ Dicas de Performance

### Modo Debug vs Modo Rápido

```python
# Modo Debug (ver o navegador)
process_csv("participants.csv", "checkout_urls.csv", debug_mode=True)

# Modo Rápido (73% mais rápido)
process_csv("participants.csv", "checkout_urls.csv", debug_mode=False)
```

### Sessão Persistente

```python
# COM sessão persistente (recomendado - pula login)
use_persistent_session=True

# SEM sessão persistente (faz login toda vez)
use_persistent_session=False
```

### Tempo Estimado

| Participantes | Modo Debug | Modo Rápido |
|---------------|------------|-------------|
| 1 | 30s | 8s |
| 10 | 5min | 1.3min |
| 50 | 25min | 6.5min |
| 100 | 50min | 13min |

---

## 🐛 Solução de Problemas

### "ChromeDriver not found"

```bash
# macOS
brew install chromedriver

# Ubuntu
sudo apt-get install chromium-chromedriver
```

### "CSV delimiter error"

Use ponto-e-vírgula (`;`) como delimitador:

```csv
name;email;phone;cpf;bday;gender;shirt_size;team
```

### "Login failed"

Verifique as credenciais no código ou nas variáveis de ambiente:

```bash
export SPRINTA_EMAIL="seu-email@empresa.com"
export SPRINTA_PASSWORD="sua-senha"
```

### GitHub Action não inicia

1. Verifique se os secrets estão configurados corretamente
2. Confirme que o arquivo `.github/workflows/process-inscricoes.yml` existe
3. Veja os logs na aba Actions

---

## 📚 Documentação Completa

- [README.md](README.md) - Documentação principal
- [API_USAGE.md](API_USAGE.md) - Guia completo da API
- [OTIMIZACAO_VELOCIDADE.md](OTIMIZACAO_VELOCIDADE.md) - Otimização de performance
- [SESSAO_PERSISTENTE.md](SESSAO_PERSISTENTE.md) - Como funciona a sessão persistente

---

## 🎯 Exemplo Completo End-to-End

### Cenário: Inscrever 50 atletas

1. **Preparar CSV** (50 linhas)
2. **Escolher método:**
   - Local: `python sprinta_automation.py` (6.5 min)
   - GitHub: Usar interface web ou API (6.5 min + setup)
3. **Receber resultados** em `checkout_urls.csv`:

```csv
email,checkout_url
joao@example.com,https://checkout.sprinta.com.br/v27310473ilMArua8LX52o6V
maria@example.com,https://checkout.sprinta.com.br/v27310474abCDefgh12345678
...
```

4. **Distribuir URLs** para os participantes

---

## ✅ Checklist de Setup

### Para Uso Local
- [ ] Python 3.12+ instalado
- [ ] Dependências instaladas (`pip install -r requirements.txt`)
- [ ] Chrome instalado
- [ ] ChromeDriver instalado
- [ ] CSV preparado com formato correto
- [ ] Credenciais configuradas (no código ou variáveis de ambiente)

### Para GitHub Actions
- [ ] Repositório criado no GitHub
- [ ] Código enviado (push)
- [ ] Secrets configurados (SPRINTA_EMAIL, SPRINTA_PASSWORD)
- [ ] Workflow testado (executar manualmente uma vez)
- [ ] (Opcional) GitHub Token criado para API
- [ ] (Opcional) Arquivo .env configurado

---

## 🆘 Suporte

**Problema não resolvido?**

1. Verifique os logs detalhados (modo debug)
2. Consulte a documentação completa no README.md
3. Abra uma issue no GitHub com:
   - Descrição do problema
   - Logs de erro
   - Versão do Python e Selenium
   - Sistema operacional

---

## 🎉 Pronto para Começar!

**Uso mais simples (local):**
```bash
pip install -r requirements.txt
python sprinta_automation.py
```

**Uso mais poderoso (GitHub Actions):**
```bash
./setup_github_repo.sh
# Depois: configure secrets e use a interface web
```

**Boa sorte! 🚀**
