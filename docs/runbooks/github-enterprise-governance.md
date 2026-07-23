# Governança empresarial do GitHub

## Baseline aplicado no repositório

- `.github/CODEOWNERS` cobre os domínios atuais, inclusive CRM, API, Workforce, Ads, Messaging, Orb e a camada de entrega.
- Todas as referências externas em `.github/workflows` usam SHA de 40 caracteres. O validador `validate-github-governance.mjs` impede novas tags ou branches.
- `.github/governance/main-ruleset.json` é a declaração reproduzível do ruleset de `main`: PR obrigatório, checks atualizados, branches em dia, conversas resolvidas, sem force push e sem exclusão.
- `staging` e `production` têm política de branches protegidas; segredos de produção não devem existir em repository secrets quando houver equivalente environment secret.

## Aplicação remota após merge

Executar apenas depois que a PR desta mudança estiver em `main` e os checks verdes confirmarem a pinagem:

1. Criar/atualizar o ruleset com `gh api --method POST repos/jubenitogarcia/skincos/rulesets --input .github/governance/main-ruleset.json`.
2. Conferir `GET /repos/jubenitogarcia/skincos/rules/branches/main`; manter a proteção legada até confirmar a mesma lista de checks no ruleset.
3. Habilitar pinagem obrigatória: `gh api --method PUT repos/jubenitogarcia/skincos/actions/permissions -F enabled=true -f allowed_actions=all -F sha_pinning_required=true`.
4. Configurar secrets por ambiente, movendo cada valor de deploy para `staging` ou `production`; remover a cópia de repository secret somente após uma execução bem-sucedida de cada ambiente. O inventário atual mostra somente `PONTO_IDEMPOTENCY_KEY` e `TIMEKEEPING_BACKUP_PASSPHRASE` já duplicados por environment; os demais permanecem no escopo de repositório e exigem migração planejada.
5. Em `production`, adicionar o time `platform-release` como reviewer obrigatório e ativar `prevent_self_review`; em `staging`, manter somente a branch policy até existir um segundo revisor.

## Segregação de secrets

| Classe | Escopo permitido | Exemplos |
| --- | --- | --- |
| CI sem deploy | repository secret, somente se indispensável | token de leitura para dependências privadas |
| Staging | environment secret `staging` | tokens Cloudflare/D1 de preview, chaves de smoke controlado |
| Produção | environment secret `production` | Cloudflare production, HMACs, SMTP, tokens de deploy |
| Organização | organization secret com allowlist de repositórios | credenciais compartilhadas e não produtivas |

Nunca copiar valores entre ambientes. Usar os mesmos nomes somente quando o GitHub Environment selecionado pelo job garante valores distintos.

### Ordem mínima para os secrets atuais

1. Criar credenciais Cloudflare distintas para staging e produção; cadastrar `CLOUDFLARE_API_TOKEN` e os HMACs de Ponto/Escala em cada Environment com valores próprios.
2. Mover os segredos de release de website (`META_*`, `BOOKING_*`, SMTP/Titan, Turnstile e tracking) para `production` e atualizar o workflow para declarar `environment: production` antes de remover a cópia de repositório.
3. Mover credenciais de preview/teste para `staging`; executar o smoke do ambiente; somente então remover as cópias globais correspondentes.
4. Manter `GH_TOKEN` apenas enquanto workflows administrativos realmente precisarem dele; substituir pelo `GITHUB_TOKEN` de permissões mínimas onde possível.

## Migração sem interrupção para Organization e repositório privado

1. Criar a Organization `<ORGANIZACAO>`; exigir 2FA, ao menos dois owners humanos e times privados `platform-release`, `crm`, `workforce`, `website`, `automation` e `security`.
2. Antes de transferir, exportar inventário sem valores: `gh secret list -R jubenitogarcia/skincos`, `gh variable list -R jubenitogarcia/skincos`, environments, rulesets, deploy keys, webhooks, Apps e permissões Actions. Fazer um mirror Git privado de contingência: `git clone --mirror https://github.com/jubenitogarcia/skincos.git`.
3. Transferir o próprio repositório para a Organization pela tela **Settings → General → Transfer** e, em seguida, torná-lo privado. Transferência preserva Git, issues, PRs, releases, webhooks, services, secrets e deploy keys; URLs antigas redirecionam, mas cada clone deve apontar explicitamente para a nova origem.
4. Atualizar clones e runtime: `git remote set-url origin https://github.com/<ORGANIZACAO>/skincos.git`; atualizar `REPO`, GitHub Apps, webhooks e integrações que validam `owner/repo`.
5. Recriar ou reassociar environment secrets e Organization secrets com allowlist; executar primeiro staging e depois produção, sem girar segredos durante a transferência.
6. Aplicar ruleset, Actions SHA pinning e aprovação de produção no escopo da Organization. Só então trocar CODEOWNERS de `@jubenitogarcia` para os times criados e ativar revisão por code owner.

Não criar um segundo repositório como fonte de verdade: transferência preserva continuidade e redirects. Repositório espelho serve apenas como checkpoint recuperável.
