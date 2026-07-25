# Pendência operacional — migração para GitHub Organization privada

**Estado:** pendente; não faz parte desta PR e não autoriza mover, renomear ou privatizar o repositório atual.

## Objetivo

Migrar `jubenitogarcia/skincos` para uma GitHub Organization e repositório privado sem interromper desenvolvimento, CI, integrações, ambientes ou deploys.

## Pré-requisitos de decisão

1. Nome da Organization, owners independentes e política de recuperação de conta.
2. Inventário de GitHub Actions, tokens, GitHub Apps, webhooks, dependabot, badges, URLs e integrações Cloudflare/terceiros que referenciam o repositório atual.
3. Plano para secrets por environment, rulesets, teams e permissões mínimas, incluindo uma segunda pessoa ou função revisora antes de exigir CODEOWNER review.
4. Janela de migração, comunicação, rollback por redirecionamento GitHub e responsáveis por validar clones, PRs, Actions e integrações externas.

## Critério de conclusão

O desenvolvimento continua no mesmo commit e URLs redirecionadas são verificadas; Actions, environments, secrets e proteções foram recriados/confirmados; nenhuma credencial foi exposta; e uma PR pós-migração comprova clone, CI e operação de ambientes. Até esses pré-requisitos, esta pendência não bloqueia o uso do repositório atual.
