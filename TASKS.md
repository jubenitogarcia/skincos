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

## Verificações executadas neste corte

- `npm run architecture:validate`
- `npm run module-catalog:validate`
- `npm run domain-boundaries:validate`
- `npm run codex:deploy-topology:test`
- testes focalizados de API, Website, Ponto e catálogo de Atendimento
- `git diff --check` e busca por caminhos removidos

## Operação externa confirmada

O runtime legado foi confirmado parado e sem consumidores ativos. As units
`crm.service`, `crm-jobs.service`, `crm-atendimento-*` e
`crm-clientes-source-refresh.*` foram retiradas do systemd e preservadas no
arquivo privado de runtime; o catálogo proprietário de Atendimento continua
ativo em modo read-only. Nenhuma credencial, dado real ou recibo externo deve
ser colocado no Git.
