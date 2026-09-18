# Deploy SKINCOS

## Superfícies Cloudflare

- O CRM independente é publicado pelo repositório `jubenitogarcia/crm`.
- Este monorepo publica apenas o gateway `api/`, Workers de domínio e o Website.
- Credenciais de Cloudflare permanecem no ambiente externo; nunca no checkout.

Não há runtime CRM, Pages shell ou publisher CRM neste repositório.

## Validação mínima

Após uma publicação, verificar:

- `systemctl is-active cloudflare-runtime.service` e ausência de reinícios inesperados;
- `https://api.skincos.com.br/health`;
- `https://crm.skincos.com.br/health` (verificação externa do repositório independente);
- smoke do módulo alterado e SHA/build efetivamente servido;
- logs de `journalctl` sem erros novos.
