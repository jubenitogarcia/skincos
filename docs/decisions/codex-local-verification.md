# Verificação local proporcional

O fluxo local usa o mesmo contrato v2 de impacto de mudança de
ops/codex/risk-policy.json e o mesmo motor de scripts/codex-autonomy-lib.mjs
usado pela CI. Não existe uma segunda classificação de paths ou risco.

## Comandos canônicos

- npm run verify:changed: identifica a mudança staged, working tree ou refs do
  pre-push e executa o menor plano compatível.
- npm run verify:full: executa a validação ampla local, além do full scan de
  Gitleaks quando o risco exige.

Em Windows, a execução do projeto deve passar por
scripts/invoke-skincos-wsl.ps1. Os hooks versionados em .githooks/ já usam esse
gateway quando ele está disponível. Ative-os no checkout com
git config core.hooksPath .githooks.

## Lanes

LOW valida git diff --check, parsing estático e secret scan do delta. Para paths
de UI explicitamente locais, acrescenta lint/typecheck focal e testes
relacionados quando eles existem. Não instala ou testa Website, API, Python,
E2E ou domínios independentes.

MEDIUM valida o pacote afetado e seus testes; suites de módulos não relacionados
ficam fora.

HIGH e CRITICAL não entram no fast lane. O verificador chama verify:full, com
arquitetura, qualidade completa, contratos de autonomia/dependency closure,
single-writer, concorrência e Gitleaks completo. A CI ainda mantém CodeQL,
SAST, E2E, rollback, staging, custody, live validation e demais gates
apropriados. Nenhum hook local promove, migra, altera produção ou substitui
global-merge-authority.

Se a classificação falhar, o relatório vira critical e o comando encerra com
falha. A ausência de Gitleaks não aprova HIGH/CRITICAL; no LOW/MEDIUM há somente
um fallback determinístico do delta para evitar instalar uma suíte global no
micro-change, enquanto o gate da CI continua obrigatório.
