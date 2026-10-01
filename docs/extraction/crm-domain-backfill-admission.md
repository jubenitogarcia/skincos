# Admissão de backfill por domínio para o CRM Core

## Estado atual

Este é um contrato de preflight somente leitura. Ele não consulta fontes de
dados, não entrega lotes, não muda rota, não publica Worker/Pages e não
desativa runtime. O verificador local
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

Portanto, a autorização para backfill e corte de produção está registrada, mas
nenhum domínio está admitido para entrega agora. A disponibilidade de schema
não substitui fonte canônica, recibos de lote, reconciliação ou rollback.

## Limite por domínio

| Domínio | Limite atual |
| --- | --- |
| Atendimento | Único candidato: projeções opacas de associação identidade/unidade em staging. Não transporta atributos de cliente. |
| Identity | Somente entrega autenticada opaca; usuários, sessões, funções e grants continuam no owner. |
| Inventory | Mantém D1, estoque e o proxy legado `/api/crm/*`; não é fallback do Core. |
| Finance | Mantém ledger, grants e importações no Worker/armazenamento Finance. |
| Messaging | Mantém conversas, consentimento e checkpoints de entrega. |
| Timekeeping | Mantém Ponto/Workforce em seu próprio release e dados. |
| Booking | Mantém disponibilidade, solicitações e auditoria de reserva. |

O plano executável por máquina está em
[`crm-domain-backfill-admission.json`](crm-domain-backfill-admission.json). Ele
mantém produção e mutação de rota como `false` e força todos os domínios, com
exceção do candidato de Atendimento, a permanecerem explicitamente excluídos.

## Como o primeiro domínio poderá avançar

Atendimento só poderá entregar uma projeção para staging quando existir, fora
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

O próximo PR de cada domínio precisa ter seu próprio contrato de fonte e prova
de staging. Nenhum contrato pode transformar a leitura de um domain owner em
cópia de banco, nem habilitar produção ou o corte do shell legado por edição
desse plano.
