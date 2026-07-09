# Codex App native operations

Este repositório deve continuar usando o código local como fonte da verdade e Cloudflare/GitHub como trilha oficial de produção. Os plugins do Codex App entram como aceleradores de inspeção, QA, deploy assistido e prototipação, sem substituir contratos de produção sem plano explícito.

## Superfícies do projeto

| Superfície | Fonte de verdade | Plugin/capacidade preferida | Comando local recomendado |
| --- | --- | --- | --- |
| Site público `espacofacial.com` | `modules/site-public/website/` | Cloudflare, Browser, Build Web Apps | `npm run codex:site:check` |
| CRM `crm.skincos.com.br` | `frontend/` + `backend/apps/crm-api/` | Browser, GitHub, Cloudflare | `npm run codex:crm:site-smoke` |
| Site EF no CRM | `frontend/SiteTrackingModule.tsx` e APIs de tracking | Browser, Build Web Apps | `npm run codex:crm:site-smoke` |
| Meta Ads no CRM | `frontend/` + `backend/apps/meta-ads/` | Browser, GitHub, Cloudflare | `npm run codex:crm:meta-ads-smoke` |
| Deploy e secrets | `.github/workflows/`, `scripts/codex-preflight.sh` | GitHub, Cloudflare | `npm run codex:preflight` |

## Uso dos plugins

## Interpretação por intenção

| Pedido curto do usuário | Ação padrão esperada |
| --- | --- |
| "verifique o site" | Rodar `npm run codex:context:online`, inspecionar `modules/site-public/website/`, validar endpoint live e usar Browser se houver UI envolvida. |
| "verifique o CRM" | Rodar contexto, identificar módulo, usar smoke headless ou Browser conforme necessidade visual. |
| "proceda com commit/push/pr/merge/deploy" | Criar branch `codex/*`, preservar alterações não relacionadas, validar, abrir PR, acompanhar checks, mergear e validar deploy live. |
| "publique" | Preferir GitHub Actions/deploy auditável; usar Wrangler local só se o fluxo oficial não cobrir o alvo. |
| "melhore a dashboard" | Usar Build Web Apps + Browser, preservar padrões visuais dos módulos existentes e validar responsivo. |
| "problema de tracking/Meta/WhatsApp" | Tratar como fluxo cross-system: website, CRM, D1, CAPI, consentimento, dedupe e live endpoint. |
| "crie protótipo/site temporário" | Usar Sites quando for demo/artefato isolado; portar para `modules/site-public/website/` antes de produção. |

## Contexto automático

Antes de tarefas amplas, rode:

```bash
npm run codex:context
```

Para tarefas que envolvem produção:

```bash
npm run codex:context:online
```

Esse comando é intencionalmente seguro: ele não imprime secrets e não altera estado.

### Browser

Use o Browser do Codex App para QA visual local e produção. Para automação sem janela, prefira os scripts headless:

```bash
npm run codex:crm:site-smoke
npm run codex:crm:meta-ads-smoke
```

Para debug visual explícito:

```bash
npm run crm:local:site-tracking -- --smoke --headed-smoke --browser
```

### Cloudflare

Use Cloudflare/Wrangler para validar bindings, D1, Pages/Workers e deploys. Antes de qualquer deploy crítico:

```bash
npm run codex:preflight
scripts/cloudflare-token-health.sh --strict
```

### GitHub

Use GitHub para PR, checks, automerge e auditoria de deploy. O fluxo preferido continua:

1. branch `codex/*`;
2. commit pequeno e verificável;
3. PR;
4. checks verdes;
5. merge/automerge;
6. deploy por GitHub Actions;
7. smoke live.

### Sites

O plugin Sites do Codex App deve ser usado para protótipos, páginas isoladas, demos e artefatos navegáveis. Ele não deve substituir o deploy oficial de `espacofacial.com` sem decisão explícita, porque o site atual depende de:

- Next.js App Router em `modules/site-public/website/`;
- OpenNext + Cloudflare Workers;
- D1 `espacofacial-booking`;
- rotas de tracking, booking, WhatsApp e CAPI.

Se um protótipo feito no Sites virar produção, ele deve ser portado para `modules/site-public/website/` e passar pelos mesmos checks.

## Checks rápidos para agentes

Use estes comandos quando o objetivo for velocidade com boa cobertura:

```bash
npm run codex:site:check
npm run codex:crm:site-smoke
npm run codex:preflight
```

Use este quando o objetivo for pré-release do funil de site:

```bash
npm run codex:site:release-check
```

Use este depois de deploys do `espacofacial.com` para evitar redescobrir estado de produção:

```bash
npm run codex:site:live-check
```

## Checklist De Release Do Site

- Trabalhe apenas na fonte de deploy `modules/site-public/website/`; a raiz antiga `website/` não dispara `.github/workflows/deploy-website-cloudflare.yml`.
- Antes de confiar no PR, confirme branch/base, `refs/pull/<n>/merge` e checks/automerge no GitHub.
- Rode `npm run quality:website` antes de publicar mudanças do site.
- Depois do merge, valide `x-app-build`, `/api/hero-media?variant=desktop`, `/api/hero-media?variant=mobile` e `/api/equipe` em produção.
- Para redirects, valide tanto URLs longas em `espacofacial.com` quanto short links `esfa.co`.
- Lembre que `esfa.co` lê primeiro o D1 `site_custom_urls`; alterar `ESFA_REDIRECTS` ou publicar o Worker não basta quando já existe linha migrada no D1.
- Prefira GitHub Actions para sincronização auditável de Worker/D1; Wrangler local pode não estar autenticado no mini-PC.

## Regras de segurança

- Não imprimir secrets em logs.
- Não trocar Cloudflare por Sites em produção sem plano de migração.
- Não abrir browser visual em automações, salvo debug explícito.
- Não incluir arquivos de evidência local, screenshots ou `.playwright-mcp/` em commits.
- Preservar alterações locais não relacionadas antes de qualquer branch/commit.

## Decisões padrão para reduzir explicações

- Se a tarefa for de implementação, executar até validação local sempre que possível.
- Se a tarefa afetar produção e o usuário disser "proceda", fazer PR/deploy/smoke completo usando GitHub Actions.
- Se houver worktree sujo, separar alterações por escopo e nunca incluir arquivos não relacionados.
- Se houver dúvida entre local e produção, verificar ambos.
- Se envolver tokens, secrets, OAuth ou credenciais, validar presença/escopo sem revelar valores.
- Se envolver tracking, preservar `event_id`, dedupe, consentimento, UTMs, `fbp/fbc/fbclid` e evidência em D1/CRM.
- Se envolver UI, validar por Browser ou Playwright e manter padrões dos módulos existentes.
- Se envolver Cloudflare, validar com `scripts/cloudflare-token-health.sh --strict` antes de culpar código.
- Pausar apenas para ações destrutivas, credenciais ausentes, decisão de negócio externa ou migração de infraestrutura.
