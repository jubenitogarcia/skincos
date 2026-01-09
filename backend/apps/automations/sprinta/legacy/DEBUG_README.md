# 🐛 Modo Debug - Sprinta Automation

## 📋 O que mudou?

O script agora tem um **MODO DEBUG** que permite visualizar todo o processo de automação passo a passo!

### ✨ Funcionalidades do Modo Debug:

- ✅ **Chrome visível** - Você vê tudo acontecendo em tempo real
- ✅ **Pausas estratégicas** - O script pausa em pontos importantes para você visualizar
- ✅ **Logs detalhados** - Mensagens com emojis mostrando cada ação
- ✅ **Pausas em erros** - Quando ocorre um erro, o navegador pausa para você inspecionar
- ✅ **Identificação do botão correto** - Mostra qual botão foi encontrado e clicado

### 🔧 Como usar:

#### 1️⃣ Teste apenas o LOGIN (recomendado primeiro):

```bash
python test_login_debug.py
```

Este script irá:
- Abrir o Chrome visível
- Tentar fazer login na plataforma Sprinta
- Pausar em cada etapa mostrando o que está acontecendo
- Manter o navegador aberto por 30s após o login para você inspecionar

#### 2️⃣ Executar a automação completa em modo DEBUG:

```bash
python sprinta_automation.py
```

O script principal agora roda em **modo debug por padrão**. Você verá:
- Todas as etapas sendo executadas
- Pausas para visualização
- Logs coloridos com emojis
- O navegador permanece aberto por 10s no final

#### 3️⃣ Executar em modo PRODUÇÃO (rápido, sem pausas):

Para desativar o modo debug, edite o final do arquivo `sprinta_automation.py`:

```python
if __name__ == "__main__":
    # Altere debug_mode=True para debug_mode=False
    process_csv("participants.csv", "checkout_urls.csv", debug_mode=False)
```

## 🔍 O que o Modo Debug mostra:

### Durante o Login:
```
🌐 Navegou para a página de login.
⏸️  [DEBUG] Página de login carregada. Aguardando 2s...
⏸️  [DEBUG] Credenciais preenchidas. Aguardando 1s antes de clicar em login...
✅ Login via página /login realizado com sucesso.
```

### Se o login falhar e tentar via cabeçalho:
```
⚠️  Tentativa de login via página /login falhou: ...
🔄 Tentando login via cabeçalho no evento...
⏸️  [DEBUG] Navegando para página do evento...
🔍 Encontrados 2 botões de login no cabeçalho.
⏸️  [DEBUG] Clicando no botão de login do cabeçalho...
⏸️  [DEBUG] Modal de login aberto. Aguardando campos de credenciais...
⏸️  [DEBUG] Credenciais preenchidas no modal.
🔍 Procurando botão específico de LOGIN (não Registrar)...
✅ Botão de login encontrado: Login
⏸️  [DEBUG] Clicando no botão de login em 2s...
✅ Login via cabeçalho realizado com sucesso.
```

### Durante o registro:
```
📋 PROCESSANDO PARTICIPANTE 1: João da Silva
🌐 Acessou a página do evento para joao@example.com.
⏸️  [DEBUG] Procurando botão 'Enroll a friend'...
✅ Primeiro clique em 'Enroll a friend' realizado.
⏸️  [DEBUG] Preenchendo dados pessoais...
📝 Formulário de dados pessoais preenchido.
⏸️  [DEBUG] Selecionando categoria 10KM...
✅ Categoria selecionada.
🎉 Checkout gerado para joao@example.com: https://...
```

## 🎯 Como identificar problemas:

1. **Se o login falhar**: O script pausará por 3-5s mostrando exatamente onde parou
2. **Se clicar no botão errado**: Você verá qual botão foi clicado nos logs
3. **Se não encontrar um elemento**: Você terá tempo para inspecionar a página

## 📝 Dicas:

- Use o DevTools do Chrome (F12) durante a execução para inspecionar elementos
- Preste atenção nas mensagens com 🔍 (indicam buscas de elementos)
- As mensagens com ⏸️ indicam pausas - aproveite para verificar a página
- Se encontrar um erro, a pausa de 5s permite você ver o estado da página

## 🚨 Correção do Bug do Login:

O problema identificado foi corrigido! Agora o script:
- ✅ Procura especificamente o botão que contém "Login", "Entrar", "Acessar" ou "Sign in"
- ✅ **NÃO** clica no botão "Registrar" por engano
- ✅ Mostra nos logs qual botão foi encontrado e clicado

## 💡 Próximos passos:

1. Execute `python test_login_debug.py` e observe se o login funciona
2. Se funcionar, teste com um participante completo
3. Observe todo o fluxo e identifique qualquer problema
4. Compartilhe os logs se encontrar erros!
