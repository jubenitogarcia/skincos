# Codex App native operations

## Superfícies do projeto

| Superfície | Fonte de verdade | Capacidade preferida | Orientação neste monorepo |
| --- | --- | --- | --- |
| Site público `espacofacial.com` | `jubenitogarcia/website` | Browser, GitHub, Cloudflare | Fonte e publisher no repositório independente; contratos públicos podem ser consumidos aqui. |
| Site EF, tracking e booking | Website independente e contratos públicos | Browser, GitHub | Preservar os endpoints públicos usados por EF e outros produtos. |
| CRM `crm.skincos.com.br` | `jubenitogarcia/crm` | Browser, GitHub, Cloudflare | Usar os comandos do repositório independente. |
| Meta Ads | `ads/meta/` e Token Vault | Browser, GitHub, Cloudflare | Validar pelo domínio Meta Ads. |
| Deploys deste monorepo | `.github/workflows/` e `scripts/codex-preflight.sh` | GitHub, Cloudflare | Operar somente superfícies mantidas por este repositório. |

O registro de `jubenitogarcia/website` como fonte exclusiva não afirma que o
runtime, DNS, rotas ou recursos Cloudflare já foram migrados. O monorepo não
contém o código-fonte nem um publicador do Website.

## Uso por intenção

- "Verifique o site": abra `jubenitogarcia/website`, rode seus checks e valide
  os endpoints públicos necessários; não procure uma cópia de fonte neste
  monorepo.
- "Verifique o CRM": abra o projeto independente
  `C:\CodexShared\Projetos\crm` e use seus próprios checks.
- "Problema de tracking/Meta/WhatsApp": preserve contratos, consentimento,
  deduplicação e consumidores cross-system; não altere a fonte Website neste
  monorepo.
- "Crie protótipo/site temporário": use Sites para demos isoladas; o código
  destinado ao Website pertence a `jubenitogarcia/website`.
- "Proceda com commit/push/PR/merge/deploy": use uma branch `codex/*`, valide
  as superfícies afetadas e publique apenas pelo repositório dono.

## Validação do monorepo

Para contexto local e preflight deste repositório:

```bash
npm run codex:context
npm run codex:preflight
```

Use GitHub Actions para os deploys de Workers/Pages que continuam pertencendo a
este monorepo. Não use este runbook como evidência de publicação ou cutover do
Website.

## Regras de segurança

- Não imprimir secrets em logs.
- Não copiar credenciais, estado de runtime ou dados de cliente entre
  repositórios.
- Não incluir evidência local, screenshots ou `.playwright-mcp/` em commits.
- Preservar alterações locais não relacionadas antes de qualquer branch ou
  commit.
