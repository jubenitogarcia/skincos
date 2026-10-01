# Custódia externa do recibo de staging do CRM Core

Este repositório é o consumidor externo do recibo assinado emitido pelo
workflow de readback do repositório independente `skincos-crm-core`. O
consumidor está em
`.github/scripts/verify-crm-core-staging-readback-receipt.mjs`, e a política
revisável de confiança está em
`.github/governance/crm-core-staging-readback-receipt-custody.json`.

Ele valida, antes de qualquer handoff para a custódia de Atendimento:

- a identidade fixa do repositório Core e sua referência `main`;
- SHA do release, digest do bundle, ID da execução que exportou o artifact e ID
  da execução que fez o readback;
- a origem Worker de staging, workflow de readback e conjunto exato de checks
  que o Core declara;
- a assinatura Ed25519, o `keyId` permitido e o fingerprint da chave pública
  pinada;
- que os três indicadores de autoridade do recibo continuam `false`.

O recibo não é uma autorização de deploy, DNS, produção, migração, backfill,
tráfego ou aposentadoria do legado. Ele é evidência limitada de um artifact
específico de staging; as demais gates de domínio continuam independentes.

## Estado de confiança atual

A política está `active` para o signer público Ed25519
`crm-core-staging-readback-20260911-r1`. A JWK pinada contém somente
`kty: OKP`, `crv: Ed25519` e `x`; ela não inclui um `kid`, metadados opcionais
ou material privado. A chave privada correspondente permanece exclusivamente
no secret do environment protegido de readback do Core, nunca neste repositório,
em logs, inputs ou artifacts.

Ativar este pin não emite uma prova nem elimina sua verificação explícita. O
verificador continua exigindo um recibo sanitizado cuja assinatura, fingerprint, identidade
do Core, SHA, digest e IDs de runs sejam exatos. Ele não autoriza deploy, DNS,
produção, dados, migração, backfill ou aposentadoria do legado.

## Próximo recibo oficial

1. Execute o export build-only do Core para um SHA atual de `main` e confirme
   que o run concluiu com sucesso.
2. Execute o readback do Core vinculado àquele SHA e ao ID do export; o signer
   usa o `keyId` já pinado e preserva apenas o `receipt.json` sanitizado.
3. Verifique o receipt no monorepo com todos os SHA, digest e IDs explícitos.
   O fingerprint calculado da JWK deve coincidir com o que foi assinado.
4. Somente depois, se as gates independentes também estiverem satisfeitas,
   forneça o receipt Base64 ao workflow de preparação de baseline de Atendimento.

Para rotação, mantenha temporariamente a chave anterior em `publicKeys` e em
`acceptedKeyIds` enquanto os recibos dentro da retenção de 90 dias ainda forem
necessários. A chave ativa fica sempre na primeira posição; remova uma chave
antiga apenas em uma mudança posterior revisada.

## Uso local de verificação

Depois de a política estar ativa, o consumidor aceita somente arquivo local e
argumentos de identidade explícitos:

```text
node .github/scripts/verify-crm-core-staging-readback-receipt.mjs verify \
  --receipt receipt.json \
  --expected-source-sha <sha-do-core> \
  --expected-artifact-digest <sha256-do-bundle> \
  --expected-artifact-run-id <run-de-exportacao> \
  --expected-readback-digest <digest-do-statement-assinado> \
  --expected-readback-run-id <run-de-readback>
```

A saída é apenas um resumo sanitizado dessas identidades. O comando não baixa
artefatos, não cria segredos, não chama Cloudflare e não acessa banco de dados.
