# Execução segura e pipelines canônicos

**Estado na baseline de 2026-07-23:** política-alvo documentada; não é prova de que todos os controles já estejam aplicados na `main` ou no provedor. Esta PR não altera workflows, bindings, ambientes, bancos ou produção.

## Regra de unidade operacional

Cada Worker, Pages, serviço, worker contínuo e pipeline de migration deve ter um único caminho canônico de publicação por ambiente. Outros workflows podem validar, construir artefatos ou chamar o pipeline canônico de forma explícita; não podem publicar a mesma unidade por caminho paralelo.

O pipeline canônico deve:

- receber o commit/artefato imutável e identificar serviço e ambiente;
- usar `concurrency` por `serviço:ambiente`, cancelando somente execuções ainda não iniciadas quando isso for seguro;
- recusar ambiente inválido, artefato sem origem verificável, módulo não liberado, segredo/binding ausente e ordem de promoção inválida;
- separar staging e produção por environments, credenciais, bindings, bancos, filas e aprovações;
- publicar somente depois de checks, migration compatível e gate explícito;
- registrar versão, artefato, ambiente, responsável, smoke e referência de rollback; e falhar de forma explícita quando a verificação não for possível.

## Promoção e rollback

O mesmo commit ou artefato deve ser promovido por preview, staging, smoke, piloto/canary e produção completa. A funcionalidade continua sob feature flag até o gate de negócio e operacional. Rollback reverte para o artefato anterior ou desliga a flag; migrations aditivas preservam a compatibilidade até a recuperação estar comprovada.

## Como aplicar sem risco

1. Inventariar todas as referências a `wrangler deploy`, Pages, migrations e chamadas de publicação para a unidade.
2. Declarar o pipeline canônico e remover ou converter caminhos concorrentes em validação sem publicação, em PR separada por unidade.
3. Testar em preview/staging com artefato identificável, lock de concorrência e falhas deliberadas de gate.
4. Registrar o artefato anterior e executar smoke/rollback antes de promover.

## Limite desta documentação

A baseline ainda indica caminhos legados de sincronização/publicação e não possui evidência consolidada de artefato imutável, concorrência por unidade, rollback ou restore em todos os serviços. Portanto, esta decisão define o contrato para as PRs corretivas; ela não torna os controles ativos por si só.
