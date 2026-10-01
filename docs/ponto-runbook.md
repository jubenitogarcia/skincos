# Workforce / Ponto — runbook atual

O Ponto é propriedade de `workforce/timekeeping` (Worker/D1) e, para a
interface, de `workforce/ponto-pages` (Pages dedicado). O gateway público é
`api/src/router.js`; nenhuma rota ou publisher do CRM legado participa desse
caminho.

## Validação local

```bash
npm --prefix workforce/timekeeping test
npm --prefix workforce/ponto-pages test
npm --prefix workforce/ponto-pages run typecheck
npm --prefix workforce/ponto-pages run build
npm --prefix api test
```

## Publicação

- Timekeeping e Core são publicados pelos workflows do domínio `workforce`.
- Ponto Pages usa exclusivamente `.github/workflows/ponto-pages-governed-publisher.yml`.
- Os projetos dedicados são `skincos-ponto-staging` e `skincos-ponto`; o projeto
  Pages geral do antigo shell não é alvo, fallback ou fonte de configuração.
- Toda promoção usa SHA imutável, evidência do estágio anterior, lease global e
  rollback do mesmo artefato.

## Segredos e dados

Segredos permanecem somente nos ambientes protegidos do GitHub/Cloudflare e no
runtime privado. Nunca gravar tokens, PII, cookies ou dumps no Git. Dados de
Ponto permanecem no D1 do próprio domínio; CRM, Financeiro, Inventário e
Atendimento são consumidos por contratos versionados.

## Rollback

Interromper a promoção, colocar o módulo em manutenção e restaurar o último
Worker/Pages comprovadamente saudável pelo publisher correspondente. Validar
health/readiness e o readback do deployment antes de reabrir o tráfego.
