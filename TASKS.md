# Tarefas atuais

## Concluídas neste corte

- Removidos `crm/`, o console/API histórico, seus publishers, CodeQL, Pages,
  scripts de migração e runtimes do monorepo.
- Mantido o gateway `/crm/*` como integração externa e removidas rotas proxy,
  fallback e imports para a implementação histórica.
- Migrado o consumidor real de Atendimento para o catálogo comercial
  read-only, sem dependência executável do produto CRM.
- Separados os writers de Ponto, Escala, Social e Meta Ads em seus próprios
  recursos de coordenação.
- Removidos atalhos, exemplos de ambiente, documentação e fixtures que
  apontavam para o CRM local ou para publishers antigos.

## Verificações antes do merge

- `npm run architecture:validate`
- `npm run module-catalog:validate`
- `npm run domain-boundaries:validate`
- `npm run codex:deploy-topology:test`
- testes focalizados de API, Website, Ponto e catálogo de Atendimento
- `git diff --check` e busca por caminhos removidos

## Operação externa

O runtime de produção e consumidores fora deste repositório devem ser
confirmados no ambiente próprio antes de aposentar qualquer serviço. Nenhuma
credencial, dado real ou recibo externo deve ser colocado no Git.
