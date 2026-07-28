# Evidência de resiliência isolada

Data: 2026-07-28. Candidato: n8n 2.32.5. Ambiente: PostgreSQL sintético,
loopback, workflows sem execução e sem integrações externas.

| Cenário | Resultado | Critério observado |
|---|---|---|
| morte do processo | PASS | health 200 antes; porta fechada após SIGKILL; exit 137; banco sem alteração além do estado sintético esperado |
| reinício | PASS | novo boot respondeu health 200; 227/227 migrations e 115 tabelas; shutdown limpo |
| porta ocupada | PASS | processo saiu exit 1 com erro de porta em uso; nenhum listener adicional |
| banco indisponível no gateway | PASS | chamada retornou JSON-RPC `database_query_failed`; sem fallback permissivo |
| filesystem somente leitura | PASS | bootstrap recusou com `Permission denied`; sem processo/listener |

O gate de resiliência de promoção permanece aberto até concluir o teste de
baixo espaço e a matriz completa de recuperação em staging isolado. O teste
`wsl --shutdown`/`SkincosWslRuntimeKeepalive` também permanece bloqueado por não
existir uma distro isolada; não se deve executar o comando contra o runtime Orb.
