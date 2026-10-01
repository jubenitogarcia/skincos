# Secrets e rotação

Segredos de GitHub, Cloudflare e integrações devem ter escopo mínimo, rotação
periódica e valores sempre fora do Git. O CRM externo mantém a própria
custódia; este repositório não armazena suas credenciais.

## Inventário deste repositório

- `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` com permissões apenas para a
  superfície que o workflow publica.
- `SESSION_SECRET`, `MIGRATION_TOKEN` e `INTEGRATIONS_ENCRYPTION_SECRET` nos
  Workers que realmente os consomem.
- `SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY`, seu `KEY_ID` e, durante uma janela
  limitada, a chave anterior/recovery separada.
- Segredos próprios de Website, Ponto, Escala, Financeiro, Social, EF App e
  Token Vault, conforme os respectivos workflows.

## Procedimento

1. Gerar o novo valor em cofre externo, sem registrá-lo em arquivos ou argv.
2. Atualizar o GitHub Environment/Cloudflare Worker correto.
3. Revogar o valor anterior somente após o readback do nome e do health check.
4. Executar o teste focal e guardar recibo sanitizado fora do Git.

Tokens de deploy devem ser revisados pelo menos a cada 90 dias; segredos de
sessão/criptografia, a cada 180 dias ou imediatamente após incidente.

## Coordenação global

A rotação altera primeiro a custódia externa, depois o Worker de coordenação,
clientes e workflows. Cada lease carrega `keyId` e `authorityEpoch`; ausência,
expiração ou divergência falha fechada. Após o TTL máximo, remover a chave
anterior e repetir `/v1/readyz` e o readback assinado.

Nenhum workflow deste repositório deve criar uma via SSH para runtime de outro
produto. O projeto CRM possui seu próprio procedimento de rotação em
`C:\CodexShared\Projetos\crm`.
