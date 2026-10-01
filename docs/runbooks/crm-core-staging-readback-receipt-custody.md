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

## Estado inicial seguro

A política versionada inicia em `public-key-pinning-pending`, sem chave pública
e sem chave privada. Isso é intencional: não havia uma chave pública real do
signer de readback disponível para ser pinada quando este consumidor foi
criado. O verificador rejeita todo recibo enquanto esse estado existir, em vez
de aceitar uma chave fornecida por input, ambiente ou pelo próprio recibo.

## Como ativar a confiança quando a custódia real existir

1. No ambiente protegido de readback do Core, mantenha a chave privada Ed25519
   exclusivamente no armazenamento de segredo daquele ambiente. Ela nunca deve
   ser copiada para este repositório, para logs ou para inputs de workflow.
2. Obtenha somente a JWK pública correspondente e o `keyId` já usados pelo
   signer. A JWK deve conter exatamente `kty: OKP`, `crv: Ed25519` e `x`.
3. Em um PR separado neste repositório, altere a política para `active`, ponha
   o `keyId` como primeiro item de `acceptedKeyIds` e de `activeKeyId`, e inclua
   apenas a JWK pública correspondente em `publicKeys`.
4. Rode os testes de custódia. O verificador compara o fingerprint calculado da
   JWK com o que foi assinado no recibo, portanto trocar a chave ou o ID depois
   da assinatura falha.
5. Só então execute o readback oficial do Core para o SHA atual e forneça o
   `receipt.json` sanitizado, codificado em Base64, ao workflow de preparação
   de baseline de Atendimento.

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
