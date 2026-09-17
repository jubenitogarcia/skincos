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

## Staging

Use `npm run finance:staging:import-smoke` somente contra o ambiente de
staging explicitamente selecionado. O script é somente leitura até a etapa de
commit indicada no próprio cenário e nunca habilita a flag de produção.

Para uma falha, preserve o artefato e o recibo fora do Git e siga o rollback do
Worker Financeiro; não redirecione o tráfego para uma implementação CRM.
