# Ownership e operação

## Fronteiras

- O produto CRM é externo e independente: `jubenitogarcia/crm` é dono do
  console, Core API, Worker/Pages, D1, identidade de entrega e rollback.
- O código-fonte e os publicadores do Website pertencem exclusivamente a
  `jubenitogarcia/website`. O monorepo `jubenitogarcia/skincos` não contém sua
  implementação nem pode publicar suas superfícies; mantém contratos e
  consumidores de APIs públicas usados por outros produtos.
- O monorepo `jubenitogarcia/skincos` mantém os domínios `api`, `finance`,
  `inventory`, `workforce`, `messaging`, `booking`, `ads`, `social` e
  `integration`.
- Dependências entre repositórios são contratos versionados e rotas
  explicitamente allowlisted. Imports locais e compartilhamento de banco,
  cookies ou segredos são proibidos. O registro de ownership do Website não
  comprova uma migração de runtime Cloudflare.

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
ownership. Times e branch protection do GitHub podem ser adicionados depois.
