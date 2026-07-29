# Qualificação de segurança — n8n 2.32.5

Status: `BLOQUEADO_POR_VULNERABILIDADE_EXPLORAVEL` para promoção. Este registro é específico do candidato e não autoriza mudança de produção.

## Método e limite da evidência

Os baselines foram instalados em fixtures sintéticos independentes (`npm ci --ignore-scripts --omit=optional`) para o runtime n8n e para cada um dos nove community nodes gerenciados. A fixture não leu configurações, dados, banco, credenciais ou workflows. Portanto, a presença do pacote é comprovada; alcançabilidade requer evidência separada e não é inferida de `npm audit`.

| Versão | Tipo | Componentes | Críticos | Altos | Decisão |
| --- | --- | ---: | ---: | ---: | --- |
| 2.8.3 | produção atual | 10 | 8 | 74 | manter até release qualificada |
| 2.19.0 | comparação | 10 | 7 | 65 | não reduz o risco a nível aceitável |
| 2.31.7 | comparação | 10 | 6 | 74 | bloqueada |
| 2.32.5 | estável oficial corrente | 10 | 6 | 74 | bloqueada |

## Matriz crítica

| Componente / advisory | Estado no candidato | Caminho e superfície | Evidência negativa | Critério de remediação |
| --- | --- | --- | --- | --- |
| `fast-xml-parser` / GHSA-m7jm-9gc2-mpf2 | crítico; versões afetadas resolvidas na árvore, inclusive 4.4.1 e 5.2.5 | transitivo de `@n8n/n8n-nodes-langchain`, AWS/LangChain e `snowflake-sdk` | busca read-only por `arxiv` retornou zero workflows; há 13 workflows com LangChain. Não há prova suficiente para excluir XML controlado pelo usuário em todos os fluxos AI. | release oficial que resolva todas as faixas críticas, ou evidência específica de fornecedor que elimine o caminho usado, seguida de reteste sintético e de workflow |
| `tar` / GHSA-23hp-3jrh-7fpw | crítico; `tar` direto 7.5.17, advisory afeta `<=7.5.18`; árvore atual também reporta faixas posteriores até `<=7.5.20` | runtime n8n direto; cópia 6.2.1 também chega via `sqlite3` | não foi observado workflow que aceite/extrate arquivo TAR; isso não descarta importação administrativa ou rota futura. Não executar arquivo hostil contra runtime. | release oficial com `tar` fora das faixas críticas e teste sintético de arquivo malformado em staging |
| `form-data` / GHSA-fjxv-7rqg-78g4 | crítico; 4.0.0–4.0.5 | runtime e community nodes Cloudinary, Evolution EN, MCP, Meta Publisher, Run Node e WebSocket | não há evidência que exclua campos multipart vindos de integrações externas; classificado alcançabilidade não descartada | release oficial/lock atualizado para versão corrigida, mais teste de campos/filename sintéticos em staging |
| `@getzep/zep-cloud`, `@langchain/community`, `@n8n/n8n-nodes-langchain` | críticos herdados | pacote AI carregado pelo runtime | 13 workflows LangChain impedem considerar cadeia inativa | resolução upstream de todas as dependências críticas e regressão dos 13 workflows em staging |

## Controle de alcance

* O MCP é somente leitura e a descoberta não expõe `execute_workflow`; ele não cria um vetor de execução de workflows.
* As rotas MCP públicas permanecem bloqueadas em `404`; isso reduz a superfície externa do gateway, mas não sana bibliotecas do runtime Orb.
* Produção não foi reiniciada, alterada nem recebeu artefato, migration, override, patch de lock ou dependência transitiva manual.

## Próxima ação autorizada

Esperar uma release oficial estável cuja árvore resolvida seja requalificada pelo auditor isolado e pela matriz de alcançabilidade. Não usar `npm audit fix`, overrides transitivos ou cópia de `node_modules` como substituto da release oficial.
