# Plano de observação pós-mudança Orb/n8n

Observar em janelas T+0, T+5 min, T+15 min, T+30 min, T+60 min e T+24 h. Os
limites são os alertas e baselines existentes do projeto; este plano não cria
thresholds novos. Coletar somente contagens, estados, latências e hashes, sem
payloads, credenciais, tokens, cookies ou dados clínicos.

| Área | Sinal | Método seguro | Critério | Evidência |
|---|---|---|---|---|
| Startup | readiness, PID, restart count, migration state | `status.sh`, `systemctl show`, `/healthz` | sem restart inesperado e migrations convergentes | TSV sanitizado |
| OAuth | erros de consentimento, constraint, grants/revoke | logs filtrados + fixture sintética; nunca valores | zero `duplicate key`, uma linha por par sintético | contagens/IDs sintéticos |
| MCP | auth, tools/list, timeout, rate-limit, sanitização | `validate-mcp.sh`, gateway audit sem payload | 9 tools readonly, sem `execute_workflow`, loopback, público 404 | resposta redigida |
| Workflows | total, active/inactive, alterações de estrutura | gateway readonly `list_workflows/search_workflows` | variações naturais registradas; nenhum workflow executado | contagens/digest |
| Executions | contagem, estados, erros/retries | gateway readonly `list_recent_executions` | nenhuma execução causada pelo change set | contagens |
| Filas | waiting/running/retry e workers | status/observabilidade existente | dentro do baseline já configurado | snapshot |
| Recursos | CPU, memória, disco | `systemctl show`, métricas já existentes, `df` | dentro dos alertas existentes | séries resumidas |
| Nodes/credenciais | falhas de node, credential errors | logs sanitizados e contagens | nenhum erro novo persistente | fingerprint de erros |
| Domínios | Orb, CRM, Booking, WhatsApp | health + jornadas sintéticas autorizadas | alcance e negativas esperadas | IDs de smoke |
| Perímetro | `/mcp-server`, `/mcp-server/http`, equivalentes | `curl` sem auth | 404 em todos | códigos HTTP |

Qualquer desvio nos critérios objetivos do runbook de rollback interrompe a
observação e preserva o checkpoint. Não usar execução manual para “aquecer” ou
validar workflows.
