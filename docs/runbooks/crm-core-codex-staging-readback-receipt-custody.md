# Custódia local do recibo de staging do CRM Core

Esta é a trilha local do Codex para validar um readback de staging do
repositório independente `skincos-crm-core` quando GitHub Actions não estiver
disponível. Ela é deliberadamente separada do contrato GitHub v1 em
`.github/scripts/verify-crm-core-staging-readback-receipt.mjs`: não aceita IDs
numéricos de runs, não usa a chave do GitHub e não altera aquele verificador.

O consumidor local é
`.github/scripts/verify-crm-core-codex-staging-readback-receipt.mjs`; a política
revisável fica em
`.github/governance/crm-core-codex-staging-readback-receipt-custody.json`.

## Limite de autoridade

O resultado é somente evidência do artefato exato em `staging`. As cinco flags
continuam obrigatoriamente `false`: deploy, produção, mudança de domínio,
backfill e aposentadoria do legado. A verificação não publica nada, não acessa
banco de dados, não cria segredo e não substitui as gates independentes de
Atendimento, Identity ou do corte de produção.

## Entradas externas obrigatórias

Mantenha todos os quatro arquivos no runtime privado do operador, fora de
qualquer repositório ou worktree. Eles devem ser arquivos regulares, sem links
simbólicos:

- `codex-staging-readback-receipt.json` — metadata sanitizada;
- `execution-receipt.json` — recibo local do artefato;
- `readback-output.json` — resultado sanitizado do readback;
- `private-readback-audit.json` — assinatura Ed25519 bruta, apenas externa.

Nenhum desses arquivos, assinatura bruta, chave privada, token, sessão, dado de
cliente ou resposta bruta entra no Git. A política fixa a JWK pública do signer
local e o fingerprint SHA-256 do SPKI; este fingerprint não é o fingerprint de
JWK canônica usado pela trilha GitHub v1.

## Verificação local

Use também um checkout limpo do Core no SHA e na árvore declarados pelo recibo.
O comando verifica o Core contra seu `origin`, confere que o checkout está limpo
e executa primeiro o verificador proprietário do Core. Só depois compara o
statement canônico da metadata ao audit privado, recalcula seu digest e verifica
a assinatura Ed25519.

```text
node .github/scripts/verify-crm-core-codex-staging-readback-receipt.mjs \
  --receipt <runtime>/codex-staging-readback-receipt.json \
  --custody-receipt <runtime>/execution-receipt.json \
  --readback-output <runtime>/readback-output.json \
  --audit <runtime>/private-readback-audit.json \
  --core-root <checkout-limpo-do-skincos-crm-core>
```

A saída contém somente SHA, árvore, IDs de deployment/execução, key ID e
fingerprint público. Um erro deve ser tratado como falha fechada; não troque por
um recibo GitHub v1 nem reduza as flags de autoridade.
