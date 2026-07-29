# Provider configuration

O modo de desenvolvimento é `dry_run=true`, `provider_policy.mode=mock`, `mock_provider=true` e `max_cost=0`. Nesse modo o mock cobre submit, status, result e cancel; nenhum HTTP é permitido.

O adapter HTTP só pode ser habilitado por configuração externa, com URL e credencial mapeadas no n8n. Chaves não entram no builder, schemas, fixtures, logs ou exports. Antes de qualquer habilitação real, executar em projeto n8n de teste com orçamento e escopo aprovados.

OpenAI Images, vídeo e voz permanecem mock-only nesta validação. Não foi feita chamada paga.
