# Custódia do backfill de Atendimento para CRM Core

O workflow manual
`.github/workflows/atendimento-crm-core-projection-backfill.yml` prepara a
baseline custodiada que será usada numa entrega posterior ao CRM Core. Ele é
fixado a `main`, a um SHA exato e ao runner `skincos-native-custody`; não abre
conexão PostgreSQL pelo workflow, não contém segredo, não configura Cloudflare,
não muda rota e não desativa o writer legado.

O helper root-owned chamado pelo workflow recebe somente uma autorização
Ed25519 curta pelo stdin. Suas capacidades ficam fora do repositório:

- conexão PostgreSQL autenticada como `crm_core_projection_exporter`, limitada
  às relações/colunas da fonte canônica e com sessão somente leitura;
- chave HMAC de referências opacas, chave Ed25519 de entrega, URL HTTPS fixa,
  allowlist finita e checkpoint privado;
- chave pública que valida a autorização do workflow e armazenamento de
  recibos brutos fora do workspace;
- chave Ed25519 distinta para assinar o recibo completo de preparação e ledger
  root-owned de `authorizationId` consumidos, ambos fora do checkout;
- verificação do artefato/recebedor do CRM Core e do rollback correspondente.

O helper prepara todos os pacotes opacos uma única vez e persiste os pacotes e
o checkpoint somente em custódia privada. O recibo sanitizado inclui a lista
finita de `batchDigest` para que o Core possa configurar a allowlist antes de
qualquer entrega. Ele nunca chama o Worker nessa fase.

Antes de cada persistência privada, o helper deve revalidar o proof de
coordenação assinado (resource, lease, fencing token e intent) contra o
coordenador com credencial guardada somente no host root-owned. Ele deve
recarregar o lease remoto e conferir que os `inputs` do intent vinculam o
repositório/ID Core, SHA, digests e IDs de exportação/readback recebidos na
autorização; comparar somente o hash de um proof local não basta. Ele deve
consumir o `authorizationId` em ledger atômico antes do snapshot e encerrar em
até 240 segundos; uma prova somente comparada em memória não é suficiente.

## Pré-requisitos que o helper deve recusar se não existirem

1. Um artifact oficial do repositório `skincos-crm-core`, para o SHA, digest e
   digests e IDs exatos de exportação/readback informados, já implantado e lido de volta
   em staging. Build local ou deploy direto não substituem esse artifact.
2. O receiver de staging opt-in, sua chave pública e um caminho para configurar
   a allowlist finita de lote exata antes da entrega; a rota deve aceitar o
   primeiro lote e retornar `idempotent` no replay posterior.
3. Fonte canônica atestada: `skincos_clientes_production`, principal
   `crm_core_projection_exporter`, transação `REPEATABLE READ READ ONLY`,
   grafo de identidade/membership e checkpoint de source-sync completos. A
   allowlist fixa é `crm_atendimento.global_client_identity_members`,
   `crm_atendimento.attendance_client_links`, `crm_atendimento.attendances` e
   `crm_atendimento.units`; o helper não pode consultar ou obter grant para
   `crm_caixa.sales` ou qualquer outra relação Finance. O helper não pode
   materializar esse grafo nem criar grants automaticamente.
4. Ambiente GitHub protegido
   `crm-atendimento-projection-backfill-staging`, com a chave privada de
   autorização e o respectivo key ID; o public key correspondente só fica na
   custódia nativa.
5. Coordenação global ativa para `release:atendimento`. O workflow adquire,
   revalida e libera esse lease antes/depois do handoff.
6. Helper instalado explicitamente por rollout root separado, com sudoers de
   argumento literal, chave pública de recibo configurada no ambiente GitHub e
   private key correspondente somente no host. O helper não existe ainda no
   runner atual; sem ele o workflow deve falhar fechado.

O helper só pode devolver um recibo schema `2`, assinado pela chave root-owned
e validado por
`.github/scripts/atendimento-crm-core-projection-backfill-receipt.mjs`: contagens,
digests, identidades de serviço, alvo staging e no máximo 100 `batchDigest`.
O workflow compara o recibo sanitizado com a autorização de uso único que ele
acabou de assinar: ID, SHA da fonte, hash do plano, release, digests e IDs de
exportação/readback precisam coincidir exatamente antes de qualquer upload.
O limite corresponde ao receiver Core atual: com pacotes de 20 eventos, a
baseline falha fechada acima de 2.000 memberships ou com zero memberships. Ela
não pode dividir ou reconfigurar uma baseline maior silenciosamente. Caminhos,
URLs, UUIDs, linhas de origem, chaves, credenciais e PII são rejeitados antes
do upload.

## Limite da mudança

Essa ponte prepara apenas o primeiro backfill opaco de **Atendimento em
staging**; uma etapa independente de entrega só pode reabrir os pacotes
selados depois de configurar a allowlist e confirmar o mesmo artefato Core.
Ela não torna produção elegível. O writer legado delimitado é o publicador
geral do CRM Pages em `.github/workflows/deploy-crm-pages.yml`
(`release_scope=general`); ele já está congelado no job
`legacy-general-publisher-freeze`. Ponto e o proxy Inventory `/api/crm/*` não
são parte desta aposentadoria. A troca de tráfego e a remoção definitiva do
writer congelado permanecem uma operação posterior, após recibo staging,
readback, rollback verificável e admissão de produção própria.
