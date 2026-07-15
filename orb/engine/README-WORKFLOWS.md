# 🤖 n8n Workflow Assistant - VS Code Integration

## Importante

- Este assistant foi desenhado para snapshots/base SQLite e nao deve ser tratado
  como interface de edicao do runtime live atual do orb.
- O runtime compartilhado do mini-PC hoje usa PostgreSQL no stack `skincos-*`.
- A versao canonica live continua sendo a visivel no browser do n8n.
- Se precisar usar este helper em contexto historico/offline, rode com
  `N8N_WORKFLOW_ASSISTANT_ALLOW_SQLITE_SNAPSHOT=1`.

Sistema completo para gerenciar workflows do n8n diretamente do VS Code, permitindo visualizar, editar e modificar workflows sem precisar usar exclusivamente o browser.

## Fonte da Verdade dos Workflows

Para este projeto, considere sempre a seguinte regra:

- A versao canonica de um workflow e' a versao mais atual visivel no browser do n8n.
- Os arquivos em `workflows/` sao apenas snapshots/exportacoes locais.
- Antes de editar um workflow pelo workspace, exporte novamente a versao atual do n8n.
- Nao aplique alteracoes sobre um JSON local antigo sem sincronizar antes.
- Se houver mudancas abertas no browser que ainda nao foram salvas, o workspace pode estar desatualizado em relacao ao editor do n8n.

Ordem de precedencia recomendada:

1. Workflow atual no browser
2. Workflow salvo mais recentemente no n8n e exportado na hora
3. JSON local antigo apenas como referencia

## ✨ Funcionalidades

- 📋 **Listar** todos os workflows com status e data de atualização
- 🔍 **Visualizar** estrutura detalhada de workflows (nodes, conexões, parâmetros)
- 📤 **Exportar** workflows para arquivos JSON editáveis
- 📥 **Importar** workflows modificados de volta ao n8n
- 🎯 **VS Code Tasks** integradas para acesso rápido via Command Palette
- 🔄 **Edição em tempo real** - mudanças aplicadas diretamente no banco de dados

## 🚀 Como Usar

### Via VS Code Tasks (Recomendado)

1. Pressione `Cmd+Shift+P` (macOS) ou `Ctrl+Shift+P` (Windows/Linux)
2. Digite "Tasks: Run Task"
3. Escolha uma das tarefas disponíveis:

   - **n8n: Listar Workflows** - Lista todos os workflows
   - **n8n: Ver Workflow (Digite ID)** - Mostra detalhes de um workflow específico
   - **n8n: Exportar Workflow para JSON** - Exporta para edição
   - **n8n: Importar Workflow de JSON** - Reimporta workflow modificado
   - **n8n: Abrir Workflow no Browser** - Abre workflow no navegador
   - **n8n: Abrir Dashboard** - Abre o n8n dashboard
   - **n8n: Ajuda do Workflow Assistant** - Mostra ajuda completa

### Via Terminal

```bash
# Listar todos os workflows
node workflow-assistant.js list
npm run list

# Ver detalhes de um workflow específico
node workflow-assistant.js show WGXr4vYkv9UoJ8zc
npm run show -- WGXr4vYkv9UoJ8zc

# Exportar workflow para JSON
node workflow-assistant.js export WGXr4vYkv9UoJ8zc workflows/livia.json
npm run export -- WGXr4vYkv9UoJ8zc workflows/livia.json

# Importar workflow de JSON (aplica mudanças)
node workflow-assistant.js import WGXr4vYkv9UoJ8zc workflows/livia.json
npm run import -- WGXr4vYkv9UoJ8zc workflows/livia.json

# Ajuda
node workflow-assistant.js help
```

## 📝 Workflow Recomendado para Editar Workflows

### 1. Liste os workflows disponíveis
```bash
npm run list
```

Resultado:
```
📋 Workflows disponíveis:

──────────────────────────────────────────────────────────────
🟢 Ativo   │ ID: WGXr4vYkv9UoJ8zc │ Livia
           │ 📅 Atualizado: 03/12/2025, 23:47
──────────────────────────────────────────────────────────────
```

### 2. Veja os detalhes do workflow
```bash
npm run show -- WGXr4vYkv9UoJ8zc
```

Isso mostrará:
- Status (Ativo/Inativo)
- Quantidade de nodes e conexões
- Lista completa de nodes com tipos e parâmetros
- Fluxo de conexões entre nodes
- Link para abrir no browser

### 3. Exporte para edição
```bash
npm run export -- WGXr4vYkv9UoJ8zc workflows/livia.json
```

O arquivo JSON será criado em `workflows/livia.json`

### 4. Edite no VS Code

Abra o arquivo `workflows/livia.json` e faça suas modificações:

```json
{
  "name": "Livia",
  "nodes": [
    {
      "id": "...",
      "name": "Google Sheets",
      "type": "n8n-nodes-base.googleSheetsTool",
      "parameters": {
        "documentId": "...",
        "sheetName": "...",
        ...
      }
    }
  ],
  "connections": {
    "Google Sheets": {
      "main": [
        [
          {
            "node": "Procedure Price Offer",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  }
}
```

**💡 Dicas de Edição:**
- Modifique parâmetros de nodes existentes
- Altere conexões entre nodes
- Renomeie nodes (mantenha consistência nas conexões)
- Ajuste posições dos nodes (`position: [x, y]`)
- Configure settings do workflow

### 5. Reimporte as mudanças
```bash
npm run import -- WGXr4vYkv9UoJ8zc workflows/livia.json
```

### 6. Recarregue o browser
Pressione **F5** no browser do n8n para ver as mudanças aplicadas.

## 🎯 Use Cases Práticos

### Exemplo 1: Duplicar um Node
1. Exporte o workflow
2. Copie o objeto do node no array `nodes`
3. Altere o `id` e `name` do node copiado
4. Adicione as conexões necessárias em `connections`
5. Reimporte

### Exemplo 2: Alterar Parâmetros em Massa
1. Exporte o workflow
2. Use Find & Replace no VS Code para alterar valores
3. Reimporte

### Exemplo 3: Reorganizar Posições dos Nodes
1. Exporte o workflow
2. Ajuste os valores em `position: [x, y]` de cada node
3. Reimporte

### Exemplo 4: Documentar Workflow
1. Exporte o workflow
2. Analise a estrutura para documentação
3. Peça ajuda ao GitHub Copilot para explicar a lógica

## 🔧 Como Pedir Ajuda ao GitHub Copilot

### Exemplo 1: Entender um Workflow
```
Copilot, analise este workflow exportado e explique o que ele faz:

[Cole o conteúdo do JSON aqui]
```

### Exemplo 2: Otimizar um Workflow
```
Copilot, veja este workflow e sugira otimizações:

[Cole o conteúdo do JSON aqui]

Especificamente, quero melhorar:
- Performance
- Organização dos nodes
- Tratamento de erros
```

### Exemplo 3: Adicionar Funcionalidade
```
Copilot, tenho este workflow:

[Cole o conteúdo do JSON aqui]

Como eu adiciono um node de validação de email entre o node X e o node Y?
Gere o JSON completo com as modificações.
```

### Exemplo 4: Debugar Problemas
```
Copilot, este workflow está dando erro:

[Cole o conteúdo do JSON aqui]

O erro é: [descreva o erro]

O que pode estar errado?
```

## 📊 Estrutura de um Workflow JSON

```json
{
  "name": "Nome do Workflow",
  "active": true,
  "nodes": [
    {
      "id": "unique-node-id",
      "name": "Nome do Node",
      "type": "n8n-nodes-base.nodeType",
      "typeVersion": 1,
      "position": [x, y],
      "parameters": {
        // Parâmetros específicos do node
      },
      "credentials": {
        // Credenciais usadas (se houver)
      }
    }
  ],
  "connections": {
    "Node Origem": {
      "main": [
        [
          {
            "node": "Node Destino",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "settings": {
    // Configurações do workflow
  },
  "staticData": null,
  "pinData": {},
  "meta": null
}
```

## 🎨 Ícones dos Nodes

O workflow assistant usa ícones para identificar tipos de nodes:

- 🌐 HTTP Request
- 🪝 Webhook
- 💻 Code / Function
- ⚡ Function Node
- 📝 Set Node
- 🔀 If / Switch
- 🔄 Merge
- ✂️ Split in Batches
- 🔁 Execute Workflow
- 📧 Email (Gmail, etc)
- 📊 Google Sheets
- 🐘 PostgreSQL
- 🐬 MySQL
- 🍃 MongoDB
- ⏰ Schedule / Cron
- ⏳ Wait
- ▶️ Start
- ❌ Error

## ⚠️ Avisos Importantes

### Backup Antes de Importar
Sempre faça backup do workflow antes de importar mudanças grandes:
```bash
npm run export -- WGXr4vYkv9UoJ8zc workflows/livia-backup-$(date +%Y%m%d).json
```

### Validação de JSON
Use o validador JSON do VS Code antes de importar. O VS Code destacará erros de sintaxe automaticamente.

### Credenciais
Os arquivos exportados **NÃO contêm as credenciais reais**, apenas referências. As credenciais ficam armazenadas separadamente no n8n.

### IDs dos Workflows
Os IDs dos workflows no n8n são **strings alfanuméricas**, não números. Exemplo: `WGXr4vYkv9UoJ8zc`

## 🔄 Sincronização com Browser

As mudancas deste assistant sao aplicadas diretamente em um banco SQLite
apontado por `N8N_DB_PATH`. Isso e util apenas para snapshots/ambientes
historicos, nao para o runtime live compartilhado atual do orb.

**Para ver as mudanças no browser:**
1. Recarregue a página (F5)
2. Ou feche e abra novamente o workflow

O n8n detectará automaticamente as mudanças no banco de dados.

## 🆘 Solução de Problemas

### Erro: "Banco de dados não encontrado"
O n8n precisa ter sido executado ao menos uma vez para criar o banco de dados.

**Solução:**
```bash
npm run service:status
```

No mini-PC compartilhado, nao use isso para operar o runtime live. Use os
comandos `service:*` do modulo e o browser do n8n.

### Erro: "Workflow não encontrado"
Verifique se o ID está correto listando todos os workflows:
```bash
npm run list
```

### Erro: "JSON inválido"
Use o validador JSON do VS Code ou um validador online antes de importar.

### Mudanças não aparecem no browser
Recarregue a página do n8n (F5) ou feche e abra novamente o workflow.

## 📚 Comandos Disponíveis

| Comando | Descrição |
|---------|-----------|
| `list`, `ls` | Lista todos os workflows |
| `show <id>` | Mostra detalhes de um workflow |
| `export <id> <file>` | Exporta workflow para JSON |
| `import <id> <file>` | Importa workflow de JSON |
| `help`, `--help`, `-h` | Mostra ajuda |

## Workflow Livia — Contrato Interno (Resumo)

Entrada esperada (por item do fluxo após Upload):
- `url`: URL final da mídia (Cloudinary).
- `candidate` (opcional): metadados do frame candidato com `rank`, `timestamp`, `timestampSeconds`, `confidence`, `reason`.

Saída esperada do Livia (schema):
- `items[]` com `mediaUrl`, `mediaType`, `title`, `alt_text`.
- `items[].bestFrame` com `bestTimestamp`, `bestTimestampSeconds`, `confidence`, `selectedFrameUrl`, `selectedFrameRank`, `selectedFrameSource`.
- `items[].frameCandidates[]` com `url`, `rank`, `timestamp`, `timestampSeconds`, `confidence`, `reason`.
- `caption` com `igCaption`, `fbCaption`, `thCaption`.

Invariantes internas:
- Para vídeo: `bestFrame.applicable=true` e `bestFrame.selectedFrameUrl` quando houver candidatos válidos.
- `frameCandidates[]` deve refletir os frames enviados para análise (mesmas URLs).

## 🔗 Links Úteis

- [n8n Documentation](https://docs.n8n.io/)
- [n8n Community](https://community.n8n.io/)
- [n8n Node Types](https://docs.n8n.io/integrations/)
- [Workflow JSON Structure](https://docs.n8n.io/hosting/configuration/import-workflows/)

## 💡 Próximos Passos

Agora que você tem o sistema configurado:

1. **Liste seus workflows** para se familiarizar
2. **Exporte um workflow simples** para entender a estrutura
3. **Faça uma modificação pequena** (ex: renomear um node)
4. **Reimporte** e veja as mudanças no browser
5. **Peça ajuda ao Copilot** para tarefas mais complexas

---

**🎉 Pronto! Agora você pode trabalhar com workflows do n8n diretamente no VS Code, com todo o poder do GitHub Copilot para te ajudar!**
