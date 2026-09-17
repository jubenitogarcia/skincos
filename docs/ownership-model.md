# Ownership e operação

## Fronteiras

- O produto CRM é externo e independente: `jubenitogarcia/crm` é dono do
  console, Core API, Worker/Pages, D1, identidade de entrega e rollback.
- O monorepo `jubenitogarcia/skincos` é dono apenas do gateway HTTP e dos
  domínios `api`, `finance`, `inventory`, `workforce`, `messaging`, `booking`,
  `website`, `ads`, `social` e `integration`.
- Dependências entre os dois repositórios são contratos versionados e rotas
  explicitamente allowlisted. Imports locais e compartilhamento de banco,
  cookies ou segredos são proibidos.

## Regras mínimas

1. Cada domínio mantém código, dados, migrations, publisher e rollback próprios.
2. O gateway falha fechado quando a identidade ou o recibo do CRM independente
   não estiverem disponíveis.
3. Alterações de produção registram artefato, versão e caminho de recuperação;
   nenhum segredo ou dado de cliente entra no Git.
4. Um consumidor legado deve ser migrado para o dono correto antes de remover
   uma compatibilidade.

## Revisão

O catálogo de módulos e o mapa de domínios são as fontes versionadas de
ownership. Times e branch protection do GitHub podem ser adicionados depois,
mas não são necessários para a separação física já concluída.
