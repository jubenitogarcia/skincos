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

- `codex-staging-readback-receipt.json` — recibo v2 sanitizado, incluindo a assinatura Ed25519 destacada no próprio recibo;
- `execution-receipt.json` — recibo local do artefato;
- `readback-output.json` — resultado sanitizado do readback;
- `private-readback-audit.json` — assinatura Ed25519 bruta, apenas externa.

Nenhum desses arquivos, bundle de artefato, assinatura destacada, chave privada,
token, sessão, dado de cliente ou resposta bruta entra no Git. A política fixa a
JWK pública do signer local e o fingerprint SHA-256 do SPKI; este fingerprint não
é o fingerprint de JWK canônica usado pela trilha GitHub v1.

## Verificação local

Use também um checkout limpo do Core, em `HEAD` destacado, no SHA e na árvore
declarados pelo recibo. `refs/remotes/origin/main` deve existir e ser descendente
desse SHA — ele pode ter avançado após o candidato ter sido validado. O recibo de
custódia, gerado no clone limpo, continua registrando aquele SHA antes e depois da
revalidação de `main`. A cadeia de custódia do Core consulta a identidade do
repositório e `refs/heads/main` via `origin` antes e depois do build; a assinatura
Ed25519 v2 do próprio recibo fixa o statement exato, e o audit externo registra o
`observedAt` UTC. Esta etapa não tenta um `fetch` sem credencial durante a leitura:
se a cadeia assinada ou o ref de rastreamento limpo não existirem, ela falha
fechada. Ele recebe um snapshot do bundle completo de artefato de custódia
(incluindo `worker`, `console` e `recheck`) e cópias temporárias dos outros três
arquivos, e falha se qualquer original ou snapshot mudar durante a verificação.

No Windows, execute pelo gateway tipado WSL:

Use os caminhos Linux visíveis no WSL nos argumentos do Node — por exemplo,
`/mnt/c/CodexRuntime/...` e `/mnt/c/CodexShared/...` — em vez de um caminho
`C:\...` literal.

```powershell
$arguments = @(
  '.github/scripts/verify-crm-core-codex-staging-readback-receipt.mjs',
  '--receipt', '<runtime-wsl>/codex-staging-readback-receipt.json',
  '--custody-receipt', '<runtime-wsl>/execution-receipt.json',
  '--readback-output', '<runtime-wsl>/readback-output.json',
  '--audit', '<runtime-wsl>/private-readback-audit.json',
  '--core-root', '<checkout-limpo-do-skincos-crm-core-wsl>'
)
& .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path -Executable node -Argument $arguments
```

A saída contém somente SHA, árvore, IDs de deployment/execução, key ID e
fingerprint público. Um erro deve ser tratado como falha fechada; não troque por
um recibo GitHub v1 nem reduza as flags de autoridade.
