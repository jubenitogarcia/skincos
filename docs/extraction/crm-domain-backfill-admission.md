# Admissão de backfill por domínio para o CRM Core

## Estado atual

Este é um contrato de admissão de preparação custodiada em staging. Ele
autoriza somente o helper fixo de Atendimento, fora do GitHub, a obter um
snapshot de fonte somente leitura para preparar pacotes opacos. Ele não entrega
lotes, não muda rota, não publica Worker/Pages e não desativa runtime. Nenhuma
leitura de fonte foi executada por esta mudança. O verificador local
`scripts/verify-crm-domain-backfill-admission.mjs` aceita apenas o plano
versionado e recusa qualquer operação `--apply`.

O readback de Cloudflare feito em 2026-09-10 confirma que a migração não está
tecnicamente elegível ainda:

- `crm.skincos.com.br` continua no projeto Pages legado `skincos`;
- o Worker de produção `skincos-crm-core` não possui deployment, versão,
  domínio ou rota ativa, e suas configurações não possuem o binding D1 do
  Core;
- o gateway `skincos-api` em produção ainda não possui um binding `CRM_CORE`;
- o gateway de staging possui o binding para `skincos-crm-core-staging`, e
  `https://api-staging.skincos.com.br/crm/health` responde `200`;
- o D1 de produção do Core tem as cinco migrations aditivas, mas todas as seis
  tabelas CRM estão sem linhas; o D1 de staging contém apenas os receipts e
  eventos sintéticos previamente reconciliados.

Portanto, a autorização de preparação custodiada está registrada, mas o
backfill e o corte de produção continuam não autorizados e nenhum domínio está
admitido para entrega agora. A disponibilidade de schema não substitui fonte
canônica, recibos de lote, reconciliação ou rollback.

## Limite por domínio

| Domínio | Limite atual |
| --- | --- |
| Atendimento | Único candidato: projeções opacas de associação identidade/unidade em staging, lidas somente de `crm_atendimento.global_client_identity_members`, `attendance_client_links`, `attendances` e `units`. Não transporta atributos de cliente. |
| Identity | Somente entrega autenticada opaca; usuários, sessões, funções e grants continuam no owner. |
| Inventory | Mantém D1, estoque e o proxy legado `/api/crm/*`; não é fallback do Core. |
| Finance | Mantém ledger, grants, importações e `crm_caixa.sales` no Worker/armazenamento Finance; nenhuma relação Finance alimenta o candidato de Atendimento. |
| Messaging | Mantém conversas, consentimento e checkpoints de entrega. |
| Timekeeping | Mantém Ponto/Workforce em seu próprio release e dados. |
| Booking | Mantém disponibilidade, solicitações e auditoria de reserva. |

O plano executável por máquina está em
[`crm-domain-backfill-admission.json`](crm-domain-backfill-admission.json). Ele
mantém produção e mutação de rota como `false`; ele permite exclusivamente a
preparação custodiada de staging para Atendimento e força todos os demais
domínios a permanecerem explicitamente excluídos. A allowlist de relações da
fonte também é parte do contrato: uma relação Finance não pode ser introduzida
por mudança da consulta de Atendimento.

## Como o primeiro domínio poderá avançar

Atendimento só poderá preparar uma projeção para staging quando existir, fora
do Git, a sequência completa de evidências listada no plano:

1. snapshot `REPEATABLE READ` atestado pelo owner, limitado a referências
   opacas e unidades canônicas;
2. principal de banco somente leitura, grants mínimos e sua atestação;
3. artefato do Core de staging com release/digest exatos e receiver opt-in;
4. allowlist finita de lotes assinados, sem segredo ou payload de origem;
5. recibos `accepted`/`idempotent` e readback D1 que reconciliem origem,
   contagem, digests e destino;
6. rollback do mesmo artefato que desative a ingestão sem apagar eventos,
   receipts ou migrations.

O helper prepara somente pacotes opacos em custódia privada; ele não pode
publicar payload, chamar o Worker ou alterar a produção. O próximo PR de cada
domínio precisa ter seu próprio contrato de fonte e prova de staging. Nenhum
contrato pode transformar a leitura de um domain owner em cópia de banco, nem
habilitar produção ou o corte do shell legado por edição desse plano.

Uma entrega posterior, inclusive para staging, exige contrato, PR e recibo de
admissão próprios; esta versão não autoriza essa etapa.
