# VS Code Responsiveness Runbook

Este runbook serve para evitar travamentos do VS Code e, se ocorrer de novo, coletar evidência para achar a causa rapidamente.

## 1) Prevenção (já aplicada nesta workspace)

Configuração em [.vscode/settings.json](.vscode/settings.json):

- Exclui pastas pesadas do file watcher: `node_modules`, `tmp`, `log-archive`, `binary-data`, `output`.
- Exclui vídeo (`.mp4`, `.mov`, `.MOV`) do watcher.
- Reduz carga de busca em diretórios grandes.
- Limita memória de scrollback do terminal (`3000`).

## 2) Como operar sem travar

1. Evite abrir arquivos gigantes diretamente (especialmente JSON snapshots e vídeos em `tmp/`).
2. Prefira comandos com saída limitada:
   - use `head`, `tail`, `sed -n`, `wc -l`.
3. Evite rodar buscas recursivas sem filtro na raiz.
4. Feche terminais com saída muito alta quando terminar.
5. Se for analisar logs longos, use arquivos temporários e resumos.

## 3) Se travar novamente: coleta de diagnóstico

Rode no terminal da workspace:

```bash
bash scripts/vscode-freeze-diagnostics.sh
```

O script salva um relatório em `tmp/vscode-diagnostics/`.

## 4) Interpretação rápida

No relatório, procure:

1. Processos com CPU alta por muito tempo (`Code Helper`, `node`, `tsserver`).
2. Memória alta (`RSS`) em `Code` ou `Code Helper`.
3. Diretórios gigantes crescendo (principalmente `tmp` e logs).
4. Quantidade de arquivos muito alta em pastas não excluídas.

## 5) O que evitar com base no resultado

1. CPU alta por indexação:
   - reduzir escopo de busca e abrir menos pastas pesadas.
2. Memória alta por terminal/log:
   - dividir comandos grandes e usar `scrollback` baixo.
3. Travamento ao abrir arquivo grande:
   - inspecionar por terminal (`head`, `jq`, `sed`) em vez do editor.
4. Travamento após execução de workflow com dumps:
   - limpar `tmp/` periodicamente e manter logs rotacionados.

## 6) Checklist rápido antes de tarefas pesadas

1. Confirme que `tmp/` não está crescendo com artefatos antigos.
2. Use comandos com paginação controlada (nunca dump completo sem filtro).
3. Evite abrir múltiplos JSON grandes ao mesmo tempo.
4. Se a tarefa for longa, faça por etapas e valide saída parcial.
