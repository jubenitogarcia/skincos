# Validação local do Financeiro

O Financeiro é validado como Worker próprio e, quando necessário, através do
gateway `api`. Não existe launcher, Pages Function ou fixture de CRM neste
monorepo.

## Checks

```bash
npm --prefix finance test
npm --prefix finance run check
npm --prefix api test
```

Os testes usam apenas fixtures sintéticas e bancos efêmeros. Nenhuma sessão,
credencial, cookie ou base remota é copiada. A autenticação é exercitada pelo
contrato de Identity e o acesso Financeiro continua condicionado a
`allowedModules`, `finance_settings` e `finance_access_grants`.

## Staging e produção

O deploy do Financeiro usa somente `deploy-finance.yml` e o smoke do Worker
(`finance/scripts/worker-release-smoke.mjs`) contra a URL de Worker explicitamente
configurada por ambiente. O smoke verifica `health`, `readiness`, versão, D1,
module-control e o estado de disponibilidade sem criar identidade, sessão,
cookie, dado financeiro ou página dentro deste monorepo.

Para uma falha, preserve o artefato e o recibo fora do Git e siga o rollback do
Worker Financeiro; o console independente do CRM faz seu próprio rollback e não
é publicado por este repositório.
