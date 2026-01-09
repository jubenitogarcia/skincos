# 📱 WhatsApp Bulk Sender - Sistema de Relatórios

## 🆕 Nova Funcionalidade: Relatórios Automáticos

O WhatsApp Bulk Sender agora gera automaticamente relatórios detalhados após cada envio em massa, registrando quais números receberam a mensagem com sucesso e quais falharam.

## 📋 Tipos de Relatório Gerados

### 1. **CSV** (📊 Planilha)
- Formato tabular para análise em Excel/Google Sheets
- Contém todos os detalhes dos envios
- Separado por sucessos e falhas

### 2. **JSON** (💾 Dados Estruturados)
- Formato para integração com outros sistemas
- Dados estruturados em formato de objeto
- Ideal para análises programáticas

### 3. **TXT** (📄 Texto Legível)
- Relatório humanamente legível
- Estatísticas resumidas
- Lista detalhada de sucessos e falhas

## 📊 Informações Registradas

### Para Cada Envio:
- **Número de telefone**
- **Timestamp** (data/hora exata)
- **Status** (sucesso ou falha)
- **Código de resposta HTTP**
- **Mensagem de erro** (se aplicável)

### Estatísticas Gerais:
- **Taxa de sucesso** (%)
- **Duração total** do envio
- **Mensagem enviada**
- **URL de mídia** (se usada)
- **Total de números processados**

## 📂 Localização dos Relatórios

Os relatórios são salvos na pasta `relatorios/` com nomes no formato:
```
relatorio_whatsapp_YYYYMMDD_HHMMSS.csv
relatorio_whatsapp_YYYYMMDD_HHMMSS.json
relatorio_whatsapp_YYYYMMDD_HHMMSS.txt
```

## 🎯 Exemplo de Uso

1. **Execute o script normalmente**
2. **Escolha os números** (manual ou arquivo)
3. **Envie as mensagens**
4. **Relatórios são gerados automaticamente** ao final

## 📁 Formatos de Arquivo Suportados

### Para Números de Telefone:
- **CSV** - Planilhas com colunas de telefone
- **Excel** (.xlsx/.xls) - Múltiplas planilhas
- **PDF** - Extração de texto
- **TXT** - Texto livre com números

### Exemplos de Detecção:
- `51999999999`
- `(51) 99999-9999`
- `+55 51 99999-9999`
- `51 9999-9999`

## 🔍 Análise dos Relatórios

### CSV - Uso no Excel:
1. Abra o arquivo CSV no Excel
2. Use filtros para analisar sucessos/falhas
3. Crie gráficos de taxa de sucesso
4. Exporte listas específicas

### JSON - Uso Programático:
```python
import json
with open('relatorio.json', 'r') as f:
    data = json.load(f)
    print(f"Taxa de sucesso: {data['relatorio_info']['taxa_sucesso']}%")
```

### TXT - Leitura Rápida:
- Abra com qualquer editor de texto
- Visualize estatísticas no topo
- Liste sucessos e falhas organizados

## ✅ Benefícios

1. **Rastreabilidade** - Saiba exatamente o que foi enviado
2. **Análise de Performance** - Identifique padrões de falha
3. **Auditoria** - Comprove envios para clientes
4. **Melhorias** - Use dados para otimizar próximos envios
5. **Compliance** - Mantenha registros detalhados

## 🚀 Dicas de Uso

- **Mantenha os relatórios** para análise histórica
- **Compare taxas de sucesso** entre diferentes listas
- **Identifique números problemáticos** para remoção
- **Use os dados** para segmentar futuras campanhas

---

*Relatórios gerados automaticamente pelo WhatsApp Bulk Sender v2.0*
