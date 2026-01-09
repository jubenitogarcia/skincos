# 🎟️ Aplicação Automática de Cupom de Desconto

## 📋 Visão Geral

A automação agora aplica automaticamente o cupom de desconto **ESPACOFACIALNH10** após gerar a URL de checkout de cada participante.

---

## 🎯 Funcionamento

### Fluxo Completo

```
1. Participante é inscrito no evento
2. Formulário completo é preenchido
3. Inscrição é finalizada
4. Redirecionado para página de checkout
   ↓
5. 🆕 Script clica em "Adicionar cupom de desconto"
6. 🆕 Preenche campo com "ESPACOFACIALNH10"
7. 🆕 Clica em "Aplicar Cupom"
8. 🆕 Aguarda confirmação
   ↓
9. URL de checkout COM DESCONTO é capturada
10. URL é retornada para o Wix
```

---

## 💻 Implementação Técnica

### Nova Função: `apply_discount_coupon()`

```python
def apply_discount_coupon(driver: webdriver.Chrome, coupon_code: str, debug_mode: bool = True) -> None:
    """Aplica um cupom de desconto na página de checkout.

    Args:
        driver: Instância do WebDriver
        coupon_code: Código do cupom a ser aplicado (ex: "ESPACOFACIALNH10")
        debug_mode: Se True, adiciona pausas para visualização
    """
```

### Localização no Código

- **Definição:** Linhas 262-410 de `sprinta_automation.py`
- **Chamada:** Linha 727, dentro de `register_participant()`

### Chamada da Função

```python
try:
    apply_discount_coupon(driver, coupon_code="ESPACOFACIALNH10", debug_mode=debug_mode)
except Exception as coupon_error:
    print(f"⚠️  Não foi possível aplicar cupom: {coupon_error}")
    # Continua sem cupom (não interrompe o fluxo)
```

---

## 🔍 Estratégias de Busca

A função usa múltiplas estratégias para garantir robustez, mesmo que a página mude:

### 1. Botão "Adicionar cupom de desconto"

```python
# Estratégia 1: Pelo texto do parágrafo
"//div[@class='_3WGKFcN9yzJhzVCXTcSFcU']//p[contains(text(), 'Adicionar cupom de desconto')]"

# Estratégia 2: Pelo div clicável
"//div[@class='_3WGKFcN9yzJhzVCXTcSFcU' and @style='cursor: pointer;']"

# Estratégia 3: Busca mais genérica
"//p[contains(text(), 'Adicionar cupom')]//parent::div"

# Estratégia 4: Por texto parcial
"//*[contains(text(), 'cupom de desconto')]//ancestor::div[@style='cursor: pointer;']"
```

### 2. Campo de Entrada do Cupom

```python
# Estratégia 1: Pelo placeholder
"//input[@placeholder='Digite o código promocional']"

# Estratégia 2: Pelo tipo e classe
"//input[@type='text' and contains(@class, 'MKo_xynqE1YeJKQ02iZ5d')]"

# Estratégia 3: Pelo parent label
"//label/input[@type='text']"
```

### 3. Botão "Aplicar Cupom"

```python
# Estratégia 1: Pelo texto exato
"//button[@type='submit' and contains(text(), 'Aplicar Cupom')]"

# Estratégia 2: Pelas classes
"//button[@type='submit' and contains(@class, '_1Uw8CVVQMCmPn4amRolA1E')]"

# Estratégia 3: Por parent div
"//div[@class='_1VZMADKLSMA0zMb4rJbEnc pUGJNJmpuP_yI5R211Ds6 PMPoizMzwUHltVK0KUSXe']//button[@type='submit']"
```

---

## ⚙️ Tratamento de Erros

### Comportamento em Caso de Falha

Se o cupom **NÃO** puder ser aplicado (por qualquer motivo):

1. ⚠️ Exibe mensagem de aviso no console
2. ✅ **CONTINUA** a execução normalmente
3. 📋 URL de checkout é capturada **SEM** o cupom aplicado
4. 🔄 Não interrompe o fluxo de inscrição

### Motivos Possíveis de Falha

- ❌ Cupom expirado
- ❌ Cupom inválido
- ❌ Limite de uso atingido
- ❌ Cupom já usado pelo participante
- ❌ Mudança na estrutura HTML da página
- ❌ Timeout ao carregar página
- ❌ Elemento não encontrado

### Exemplo de Log de Erro

```
⚠️  Não foi possível aplicar cupom: Timeout ao procurar botão 'Aplicar Cupom'
⏸️  [DEBUG] Continuando sem cupom...
🎉 Checkout gerado para joao@example.com: https://checkout.sprinta.com.br/...
```

---

## 📊 Logs de Execução

### Sucesso (Com Cupom Aplicado)

```
✅ Informações de camiseta e equipe preenchidas. Finalizando inscrição...
⏸️  [DEBUG] Aguardando redirecionamento para checkout...
🎟️  [DEBUG] Aplicando cupom de desconto ESPACOFACIALNH10...
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
🎉 Checkout gerado para joao@example.com: https://checkout.sprinta.com.br/...
```

### Falha (Sem Cupom)

```
✅ Informações de camiseta e equipe preenchidas. Finalizando inscrição...
⏸️  [DEBUG] Aguardando redirecionamento para checkout...
🎟️  [DEBUG] Aplicando cupom de desconto ESPACOFACIALNH10...
🎟️  Procurando botão 'Adicionar cupom de desconto'...
🔍 Tentando estratégia 1 para botão de cupom...
⚠️  Estratégia 1 falhou, tentando próxima...
🔍 Tentando estratégia 2 para botão de cupom...
⚠️  Estratégia 2 falhou, tentando próxima...
❌ Erro ao aplicar cupom: Não foi possível encontrar o botão 'Adicionar cupom de desconto'
⚠️  Não foi possível aplicar cupom: Não foi possível encontrar o botão 'Adicionar cupom de desconto'
⏸️  [DEBUG] Continuando sem cupom...
🎉 Checkout gerado para joao@example.com: https://checkout.sprinta.com.br/...
```

---

## 🧪 Como Testar

### Teste Local (Com Debug)

```bash
# Modo debug - vê cada passo
python sprinta_automation.py
```

### Teste Produção (Sem Debug)

```bash
# Modo headless - mais rápido
HEADLESS=true python sprinta_automation.py
```

### O Que Observar

1. ✅ Script clica em "Adicionar cupom de desconto"
2. ✅ Campo de cupom aparece
3. ✅ Código "ESPACOFACIALNH10" é inserido
4. ✅ Botão "Aplicar Cupom" é clicado
5. ✅ Página recarrega/atualiza (confirmação visual)
6. ✅ URL de checkout capturada contém desconto aplicado

---

## 🔄 Integração com Wix

### Fluxo Completo Wix → Sprinta

```
┌─────────────────────────────────────────────────────────┐
│  1. Usuário preenche formulário no Wix                 │
│     ↓                                                   │
│  2. Wix envia CSV para webhook                          │
│     ↓                                                   │
│  3. Webhook aciona GitHub Actions                       │
│     ↓                                                   │
│  4. GitHub Actions executa sprinta_automation.py        │
│     ↓                                                   │
│  5. Script inscreve participante                        │
│     ↓                                                   │
│  6. ✨ Script aplica cupom AUTOMATICAMENTE              │
│     ↓                                                   │
│  7. URL de checkout COM DESCONTO é gerada               │
│     ↓                                                   │
│  8. GitHub Actions retorna URL                          │
│     ↓                                                   │
│  9. Webhook envia URL para Wix (callback)               │
│     ↓                                                   │
│  10. Wix envia e-mail para usuário                      │
│     ↓                                                   │
│  11. Usuário clica no link                              │
│     ↓                                                   │
│  12. 🎉 Página de checkout JÁ COM DESCONTO APLICADO!    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Vantagens

✅ **Usuário não precisa inserir cupom manualmente**
✅ **Desconto aplicado automaticamente**
✅ **Experiência de checkout mais rápida**
✅ **Menos chances de erro (cupom digitado errado)**
✅ **Processo totalmente automatizado**

---

## 🛠️ Alterar o Código do Cupom

Se precisar mudar o código do cupom no futuro:

### Opção 1: Editar o Código

```python
# Linha 727 em sprinta_automation.py
apply_discount_coupon(driver, coupon_code="NOVO_CUPOM_AQUI", debug_mode=debug_mode)
```

### Opção 2: Variável de Ambiente

Você pode modificar para usar variável de ambiente:

```python
# No início do arquivo
DISCOUNT_COUPON = os.environ.get('DISCOUNT_COUPON', 'ESPACOFACIALNH10')

# Na linha 727
apply_discount_coupon(driver, coupon_code=DISCOUNT_COUPON, debug_mode=debug_mode)
```

Depois configure no `.env` ou GitHub Secrets:
```bash
DISCOUNT_COUPON=NOVO_CUPOM_2025
```

---

## 🚨 Troubleshooting

### Problema: Cupom não é aplicado

**Sintomas:**
- Log mostra "Não foi possível aplicar cupom"
- URL de checkout não tem desconto

**Soluções:**

1. **Verificar se cupom é válido:**
   - Testar manualmente no site
   - Verificar data de expiração
   - Confirmar limite de uso

2. **Verificar estrutura HTML:**
   - Sprinta pode ter mudado a página
   - Atualizar XPaths no código
   - Adicionar novas estratégias de busca

3. **Aumentar timeouts:**
   ```python
   # Se página demora para carregar
   WebDriverWait(driver, 15).until(...)  # Era 5, agora 15
   ```

4. **Testar em modo debug:**
   ```bash
   python sprinta_automation.py
   ```
   Observe onde o script para/falha

### Problema: Script trava na aplicação do cupom

**Sintomas:**
- Script para e não continua
- Timeout infinito

**Soluções:**

1. **Verificar internet:**
   - Conexão estável necessária

2. **Atualizar Selenium/ChromeDriver:**
   ```bash
   pip install --upgrade selenium
   ```

3. **Adicionar timeout no try/except:**
   ```python
   try:
       apply_discount_coupon(driver, coupon_code="ESPACOFACIALNH10", debug_mode=debug_mode)
   except Exception as coupon_error:
       print(f"⚠️  Timeout ou erro: {coupon_error}")
   ```

---

## 📝 Checklist de Deploy

Antes de fazer push para produção:

- [ ] Testar localmente com 1 participante
- [ ] Verificar cupom aplicado corretamente
- [ ] Verificar URL de checkout contém desconto
- [ ] Testar cenário de falha (cupom inválido)
- [ ] Verificar que script continua mesmo sem cupom
- [ ] Atualizar documentação se necessário
- [ ] Commit e push para GitHub
- [ ] Testar via GitHub Actions
- [ ] Testar integração completa com Wix

---

## 📚 Arquivos Relacionados

- `sprinta_automation.py` - Script principal (função `apply_discount_coupon`)
- `.github/workflows/process-inscricoes.yml` - GitHub Actions workflow
- `webhook_server.py` - Webhook que aciona o script
- `WIX_INTEGRATION.md` - Guia de integração com Wix

---

## 🎉 Resumo

A automação agora é **ainda mais completa**:

✅ Inscrição automática
✅ Preenchimento de formulários
✅ Seleção de categorias e kits
✅ 🆕 **Aplicação automática de cupom**
✅ Captura de URL de checkout
✅ Integração com Wix
✅ Notificação por e-mail

**Resultado:** Experiência 100% automatizada do formulário Wix até o checkout com desconto aplicado! 🚀
