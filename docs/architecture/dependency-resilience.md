# Resiliência de dependências

A classificação completa está em [module-catalog.json](module-catalog.json) e a política executável está em [dependency-policy.json](../../ops/resilience/dependency-policy.json). Toda dependência de cada módulo é `hard` (necessária para aquela capacidade) ou `optional` (degrada somente a capacidade que a chama). `shared` é uma dependência rígida de contrato local, não uma chamada remota.

Para dependências opcionais, o padrão é timeout de 800 ms, duas falhas antes do circuit breaker, cooldown de 15 s, resposta degradada explícita e `pendingSynchronization=true`. Cache só é permitido para projeções de leitura explicitamente marcadas como `safe-read-only`; estoque, autenticação, mutações, disponibilidade de reserva e financeiro não usam cache implícito.

O adaptador de service binding em [cloudflare-service-binding.js](../../shared/service-adapters/cloudflare-service-binding.js) já aplica esse comportamento às rotas opcionais Inventory e Workforce do gateway. Ele devolve `503` somente para a rota afetada, com `x-skincos-dependency-status` e `x-skincos-sync-state: pending`; `GET /health` do gateway permanece disponível. Demais integrações adotam o mesmo contrato quando forem extraídas de seus processos atuais.

| Classe | Quando falha | Resposta esperada |
| --- | --- | --- |
| Rígida | A capacidade local não pode executar com segurança. | Falha controlada da capacidade (`required_dependency_unavailable`), sem mascarar dados nem transformar em sincronização pendente. |
| Opcional | Um serviço externo, Worker, conector ou projeção está indisponível. | Timeout curto, circuito aberto, fallback seguro/cache permitido e indicação de sincronização pendente. A saúde e as rotas sem relação permanecem ativas. |

Os testes de política derrubam deliberadamente cada dependência catalogada: cada opcional deve retornar degradado e pendente; cada rígida deve falhar fechada apenas na capacidade dependente. Os testes específicos do gateway também derrubam Inventory e Workforce e confirmam que `/health` continua `200`.
