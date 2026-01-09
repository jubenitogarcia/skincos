# 🎟️ Guia de Aplicação de Cupom de Desconto

## 📋 Visão Geral

O sistema Sprinta Automation possui **duas formas** de aplicar o cupom de desconto `ESPACOFACIALNH10`:

1. **Automática** - Durante o processo de inscrição (integrado)
2. **Manual** - Aplicar cupom em URLs de checkout já existentes

---

## 🔄 Método 1: Aplicação Automática (Integrada)

### Como Funciona

Durante o processo de inscrição automática, o cupom é aplicado **automaticamente** após gerar a URL de checkout.

**Fluxo:**
```
Inscrição → Dados Pessoais → Categoria → Kit → Camiseta → Checkout → ✨ CUPOM APLICADO ✨
```

### Código Responsável

```python
# Em sprinta_automation.py - função register_participant()

# Após redirecionar para checkout
WebDriverWait(driver, 10).until(EC.url_contains("checkout.sprinta.com.br"))

# Aplicar cupom automaticamente
try:
    apply_discount_coupon(driver, coupon_code="ESPACOFACIALNH10", debug_mode=debug_mode)
except Exception as coupon_error:
    print(f"⚠️  Não foi possível aplicar cupom: {coupon_error}")
```

### Quando Usar

- ✅ Processamento de inscrições novas via CSV
- ✅ Automação completa do início ao fim
- ✅ Integração com GitHub Actions
- ✅ Fluxo normal do sistema

---

## 🎯 Método 2: Aplicação Manual em URL Existente

### Como Funciona

Se você já possui uma URL de checkout (gerada anteriormente ou manualmente), pode aplicar o cupom usando a função `apply_coupon_to_checkout_url()`.

**Fluxo:**
```
URL Existente → Abrir Navegador → Acessar URL → ✨ APLICAR CUPOM ✨
```

### Função Disponível

```python
def apply_coupon_to_checkout_url(
    checkout_url: str,
    coupon_code: str = "ESPACOFACIALNH10",
    debug_mode: bool = True,
    headless: bool = False
) -> bool:
    """Acessa uma URL de checkout e aplica um cupom de desconto.

    Args:
        checkout_url: URL completa do checkout
        coupon_code: Código do cupom (padrão: ESPACOFACIALNH10)
        debug_mode: Se True, mostra logs detalhados
        headless: Se True, executa sem interface gráfica

    Returns:
        True se o cupom foi aplicado com sucesso
    """
```

### Uso via Python

```python
from sprinta_automation import apply_coupon_to_checkout_url

# Aplicar cupom em uma URL específica
success = apply_coupon_to_checkout_url(
    checkout_url="https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g",
    coupon_code="ESPACOFACIALNH10",
    debug_mode=True,
    headless=False  # False = mostra navegador
)

if success:
    print("✅ Cupom aplicado!")
else:
    print("❌ Falha ao aplicar cupom")
```

### Uso via Script de Teste

```bash
# Testar com URL padrão
python test_apply_coupon.py

# Testar com URL específica
python test_apply_coupon.py "https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g"

# Modo headless (sem interface gráfica)
HEADLESS=true python test_apply_coupon.py
```

### Quando Usar

- ✅ URLs de checkout geradas manualmente
- ✅ Recuperar checkouts antigos sem cupom
- ✅ Testar aplicação de cupom isoladamente
- ✅ Debugging e troubleshooting
- ✅ Aplicar cupom em URLs fornecidas por terceiros

---

## 🔍 Como Funciona Internamente

### 1. Identificar Botão "Adicionar Cupom"

A função usa **múltiplas estratégias** para encontrar o botão:

```html
<!-- Estrutura HTML do botão -->
<div class="_3WGKFcN9yzJhzVCXTcSFcU" style="cursor: pointer;">
    <i class="_22H1FkKUsn0uUlxYQg8anB..."></i>
    <p>Adicionar cupom de desconto</p>
    <div style="float: right;">
        <i class="_22H1FkKUsn0uUlxYQg8anB..."></i>
    </div>
</div>
```

**Estratégias de busca:**
1. Pelo texto do parágrafo: `//p[contains(text(), 'Adicionar cupom de desconto')]`
2. Pelo div clicável: `//div[@class='_3WGKFcN9yzJhzVCXTcSFcU' and @style='cursor: pointer;']`
3. Busca genérica: `//p[contains(text(), 'Adicionar cupom')]//parent::div`
4. Por texto parcial: `//*[contains(text(), 'cupom de desconto')]//ancestor::div[@style='cursor: pointer;']`

### 2. Clicar no Botão

```python
# Rolar até o botão
driver.execute_script("arguments[0].scrollIntoView({block:'center'});", add_coupon_button)

# Clicar
add_coupon_button.click()
```

### 3. Aguardar Formulário Aparecer

```python
# Aguardar formulário de cupom
WebDriverWait(driver, 5).until(
    EC.presence_of_element_located((By.XPATH, "//form[@class='FkB2Vo2yYLmGogz96i75B _3k-9NwzfyW_ASK8Jtrq2aY ']"))
)
```

### 4. Preencher Campo de Cupom

```html
<!-- Estrutura HTML do campo -->
<div class="_2T9fn0Mi7wNifMEiC_lWwl">
    <label>
        <input type="text"
               placeholder="Digite o código promocional"
               value=""
               class="MKo_xynqE1YeJKQ02iZ5d">
    </label>
</div>
```

**Estratégias de busca:**
1. Pelo placeholder: `//input[@placeholder='Digite o código promocional']`
2. Pelo tipo e classe: `//input[@type='text' and contains(@class, 'MKo_xynqE1YeJKQ02iZ5d')]`
3. Pelo parent label: `//label/input[@type='text']`

```python
# Preencher campo
coupon_input.clear()
coupon_input.send_keys("ESPACOFACIALNH10")
```

### 5. Clicar em "Aplicar Cupom"

```html
<!-- Estrutura HTML do botão -->
<div class="_1RgJBdMJ7eEN4NzWNq0vuT _3_0m8H1YEFmxCQMDBlp3hT">
    <button type="submit"
            class="_1Uw8CVVQMCmPn4amRolA1E _1sowNhRIq3kzqiL-Emk9mJ">
        Aplicar Cupom
    </button>
</div>
```

**Estratégias de busca:**
1. Pelo texto exato: `//button[@type='submit' and contains(text(), 'Aplicar Cupom')]`
2. Pelas classes: `//button[@type='submit' and contains(@class, '_1Uw8CVVQMCmPn4amRolA1E')]`
3. Por parent div: `//div[@class='_1VZMADKLSMA0zMb4rJbEnc...']//button[@type='submit']`

```python
# Clicar
apply_button.click()
```

---

## 🧪 Testando a Aplicação de Cupom

### Teste Rápido

```bash
# Baixar o script de teste (se ainda não tiver)
cd /Users/jubenitogarcia/Downloads/Sprinta

# Executar teste com URL padrão
python test_apply_coupon.py

# Ver o navegador em ação (modo debug ativado automaticamente)
```

### URL de Teste

```
https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g
```

### Resultado Esperado

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧪 TESTE DE APLICAÇÃO DE CUPOM DE DESCONTO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 Checkout URL: https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g
🎫 Cupom: ESPACOFACIALNH10
🐛 Modo Debug: Ativado
👻 Headless: Não (navegador visível)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏳ Iniciando teste...
💡 Dica: Observe o navegador para ver cada etapa sendo executada!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎟️  APLICAÇÃO DE CUPOM EM CHECKOUT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 URL: https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g
🎫 Cupom: ESPACOFACIALNH10
🐛 Debug: Ativado
👻 Headless: Não
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌐 Acessando URL do checkout...
✅ Página carregada: Checkout - Sprinta
⏸️  [DEBUG] Aguardando página estabilizar...
🎟️  Procurando botão 'Adicionar cupom de desconto'...
🔍 Tentando estratégia 1 para botão de cupom...
✅ Botão 'Adicionar cupom' encontrado com estratégia 1
✅ Clicou em 'Adicionar cupom de desconto'
⏸️  [DEBUG] Aguardando campo de cupom aparecer...
🔍 Tentando estratégia 1 para campo de cupom...
✅ Campo de cupom encontrado com estratégia 1
✅ Código do cupom 'ESPACOFACIALNH10' inserido
⏸️  [DEBUG] Procurando botão 'Aplicar Cupom'...
🔍 Tentando estratégia 1 para botão 'Aplicar Cupom'...
✅ Botão 'Aplicar Cupom' encontrado com estratégia 1
✅ Cupom 'ESPACOFACIALNH10' aplicado com sucesso!
⏸️  [DEBUG] Aguardando confirmação de aplicação do cupom...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 CUPOM APLICADO COM SUCESSO!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ URL: https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g
✅ Cupom: ESPACOFACIALNH10
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏸️  [DEBUG] Mantendo navegador aberto por 10s para verificação...
🔒 Navegador fechado.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ TESTE CONCLUÍDO COM SUCESSO!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ O cupom foi aplicado corretamente na página de checkout
✅ Você pode verificar que o desconto foi aplicado
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 🐛 Troubleshooting

### ❌ Botão "Adicionar Cupom" não encontrado

**Problema:**
```
❌ Erro ao aplicar cupom: Não foi possível encontrar o botão 'Adicionar cupom de desconto'
```

**Possíveis causas:**
1. Página não carregou completamente
2. HTML da página mudou
3. Cupom já foi aplicado anteriormente
4. URL de checkout inválida ou expirada

**Solução:**
```python
# Aumentar timeout
WebDriverWait(driver, 15).until(...)  # Era 5, agora 15

# Verificar se a URL é válida
if "checkout.sprinta.com.br" not in checkout_url:
    print("❌ URL inválida")
```

### ❌ Campo de cupom não aparece

**Problema:**
```
❌ Não foi possível encontrar o campo de entrada do cupom
```

**Possíveis causas:**
1. Botão não foi clicado corretamente
2. Animação de abertura ainda em andamento
3. Formulário está oculto por algum motivo

**Solução:**
```python
# Adicionar mais tempo de espera
time.sleep(2)  # Aguardar animação

# Verificar se formulário está visível
form_visible = driver.execute_script(
    "return document.querySelector('form.FkB2Vo2yYLmGogz96i75B').offsetParent !== null"
)
```

### ❌ Botão "Aplicar Cupom" não clica

**Problema:**
```
❌ Não foi possível encontrar o botão 'Aplicar Cupom'
```

**Possíveis causas:**
1. Campo de cupom não foi preenchido
2. Botão está desabilitado
3. Código do cupom está vazio

**Solução:**
```python
# Verificar se campo foi preenchido
valor_campo = coupon_input.get_attribute('value')
if not valor_campo:
    coupon_input.send_keys(coupon_code)

# Verificar se botão está habilitado
button_enabled = apply_button.is_enabled()
if not button_enabled:
    print("⚠️  Botão está desabilitado")
```

---

## 📊 Comparação dos Métodos

| Aspecto | Automático (Integrado) | Manual (URL Existente) |
|---------|------------------------|------------------------|
| **Quando usar** | Novas inscrições | URLs já existentes |
| **Navegador** | Usa sessão existente | Cria novo navegador |
| **Performance** | Mais rápido | Um pouco mais lento |
| **Uso** | Fluxo principal CSV | Script separado |
| **Debug** | Logs do processo completo | Logs focados no cupom |
| **Caso de uso** | Produção | Teste/Recuperação |

---

## 💡 Dicas e Boas Práticas

### 1. Sempre Verificar Desconto Aplicado

Após aplicar o cupom, verifique visualmente se:
- ✅ Mensagem de sucesso aparece
- ✅ Valor do desconto é exibido
- ✅ Total foi recalculado

### 2. Timeout Adequado

```python
# Aumentar timeout se a internet estiver lenta
WebDriverWait(driver, 15).until(...)  # Em vez de 5
```

### 3. Modo Debug para Troubleshooting

```python
# Sempre use debug_mode=True ao testar
apply_coupon_to_checkout_url(
    checkout_url=url,
    debug_mode=True  # ← Importante!
)
```

### 4. Salvar Screenshot em Caso de Erro

```python
try:
    apply_discount_coupon(driver, coupon_code)
except Exception as e:
    # Salvar screenshot para análise
    driver.save_screenshot("erro_cupom.png")
    raise
```

---

## 📚 Exemplos Práticos

### Exemplo 1: Aplicar cupom em lote

```python
from sprinta_automation import apply_coupon_to_checkout_url

# Lista de URLs de checkout sem cupom
checkout_urls = [
    "https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g",
    "https://checkout.sprinta.com.br/v27310474abCDefgh12345678",
    "https://checkout.sprinta.com.br/v27310475xyz98765aBcDeFg",
]

# Aplicar cupom em todas
for url in checkout_urls:
    print(f"\n📍 Processando: {url}")
    success = apply_coupon_to_checkout_url(
        checkout_url=url,
        debug_mode=False,  # Modo rápido
        headless=True  # Sem interface
    )

    if success:
        print(f"✅ Cupom aplicado em: {url}")
    else:
        print(f"❌ Falha em: {url}")
```

### Exemplo 2: Integrar com DataFrame

```python
import pandas as pd
from sprinta_automation import apply_coupon_to_checkout_url

# Ler CSV com URLs sem cupom
df = pd.read_csv("checkout_urls.csv")

# Aplicar cupom em cada URL
df['cupom_aplicado'] = df['checkout_url'].apply(
    lambda url: apply_coupon_to_checkout_url(url, debug_mode=False, headless=True)
)

# Salvar resultado
df.to_csv("checkout_urls_com_cupom.csv", index=False)
print(f"✅ {df['cupom_aplicado'].sum()} cupons aplicados com sucesso!")
```

---

## 📞 Suporte

**Documentação relacionada:**
- 📖 [NOVA_ARQUITETURA_WEBHOOK.md](NOVA_ARQUITETURA_WEBHOOK.md)
- 📖 [README.md](README.md)
- 🧪 [test_apply_coupon.py](test_apply_coupon.py)

**Para problemas:**
1. Verificar logs detalhados (debug_mode=True)
2. Salvar screenshot em caso de erro
3. Testar com URL de exemplo
4. Verificar se o site Sprinta mudou o HTML

---

**🎯 Status:** ✅ Documentação completa
**📅 Última atualização:** 4 de Outubro de 2025
**🎫 Cupom padrão:** ESPACOFACIALNH10
