# 📊 Como Extrair Relatório do Terminal

Se você executou o WhatsApp Bulk Sender e viu o output no terminal, você pode usar este método para gerar relatórios a partir dessa informação.

## 🔧 Método 1: Usar o Analisador Automático

Execute o script analisador:

```bash
python3 terminal_analyzer.py
```

Depois cole o output do terminal quando solicitado.

## 📝 Método 2: Copiar e Colar Manualmente

Se você tem o output salvo, você pode criar um arquivo de texto com as informações e processá-lo.

### Exemplo de Output do Terminal:
```
📦 BLOCO 1/2 - 5 números
----------------------------------------
  📤 [1/5] Enviando para 51999999999...
    ✅ 51999999999: Enviado com sucesso
    ✅ Pausa de 8s concluída!
  📤 [2/5] Enviando para 11888888888...
    ❌ 11888888888: Erro 400
    ✅ Pausa de 12s concluída!
  📤 [3/5] Enviando para 21777777777...
    ✅ 21777777777: Enviado com sucesso
    ✅ Pausa de 7s concluída!
  📤 [4/5] Enviando para 47666666666...
    ❌ 47666666666: Erro - Timeout
    ✅ Pausa de 10s concluída!
  📤 [5/5] Enviando para 85555555555...
    ✅ 85555555555: Enviado com sucesso
✅ Bloco 1 concluído!
```

## 🚀 Uso do Analisador

1. **Execute o analisador:**
   ```bash
   python3 terminal_analyzer.py
   ```

2. **Cole o output do terminal**

3. **Digite a mensagem** que foi enviada

4. **Relatórios são gerados automaticamente**

Os arquivos serão salvos em `relatorios/terminal_output_TIMESTAMP.*`
