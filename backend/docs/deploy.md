# Deploy SKINCOS

## Superfícies Cloudflare

- CRM UI: `crm/console`, publicado em `https://crm.skincos.com.br` por `.github/workflows/deploy-crm-pages.yml`.
- Gateway/API e Workers: publicados pelos workflows específicos de `api/`, `website/` e dos domínios proprietários.
- Credenciais de Cloudflare permanecem em GitHub Actions/Cloudflare; nunca no checkout.

## CRM API nativa

O CRM API ativo roda como `crm.service` no filesystem Linux, a partir de `/opt/skincos/current/source`. O release é promovido somente pelo procedimento controlado de runtime em `docs/runbooks/lifecycle-runtime-cutover.md`, com backup e rollback prévios.

Não existe workflow GitHub de deploy do CRM API. A antiga via SSH foi removida para evitar um segundo publisher; a promoção nativa é a fonte de verdade neste host.

Não existe modo de deploy ou restart por HTTP. O CRM não pode executar `git checkout`, `git reset` ou reiniciar serviços a partir de uma requisição de aplicação.

## Validação mínima

Após uma publicação, verificar:

- `systemctl is-active crm.service` e ausência de reinícios inesperados;
- `http://127.0.0.1:8099/health`;
- `https://crm.skincos.com.br/api/health`;
- smoke do módulo alterado e SHA/build efetivamente servido;
- logs de `journalctl` sem erros novos.
