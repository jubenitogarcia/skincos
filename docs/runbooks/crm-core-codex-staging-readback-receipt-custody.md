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
O verificador exige que `refs/remotes/origin/main` do checkout limpo seja o
mesmo SHA e que o recibo de custódia, gerado no clone limpo, registre aquele SHA
antes e depois da revalidação de `main`. Ele recebe cópias temporárias imutáveis
dos quatro arquivos e falha se qualquer original mudar durante a verificação. O
`observedAt` UTC no statement assinado do audit registra quando o readback foi
observado.

No Windows, execute pelo gateway tipado WSL:

```powershell
$arguments = @(
  '.github/scripts/verify-crm-core-codex-staging-readback-receipt.mjs',
  '--receipt', '<runtime>/codex-staging-readback-receipt.json',
  '--custody-receipt', '<runtime>/execution-receipt.json',
  '--readback-output', '<runtime>/readback-output.json',
  '--audit', '<runtime>/private-readback-audit.json',
  '--core-root', '<checkout-limpo-do-skincos-crm-core>'
)
& .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path -Executable node -Argument $arguments
```

A saída contém somente SHA, árvore, IDs de deployment/execução, key ID e
fingerprint público. Um erro deve ser tratado como falha fechada; não troque por
um recibo GitHub v1 nem reduza as flags de autoridade.
