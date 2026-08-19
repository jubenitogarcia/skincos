# Migração para GitHub Organization privada

Este runbook prepara a transferência de `jubenitogarcia/skincos` para uma
Organization privada sem publicar software, executar migration, alterar flags
ou ativar pilotos. A transferência só começa em uma janela administrativa
dedicada e com os dois owners presentes.

O plano versionado está em
[`ops/governance/github-repository-transfer-plan.json`](../../ops/governance/github-repository-transfer-plan.json).
Ele deliberadamente não contém slug da Organization nem identidades: ambas são
decisões administrativas e não devem ser inferidas.

## Inventário antes da transferência

Execute em uma estação autenticada, com saída fora do repositório. O exportador
nunca lê valores de secrets nem URLs de webhooks; a saída privada contém apenas
nomes de secrets/variables para reconferência.

```powershell
wsl.exe -d Ubuntu-24.04 -u admin -- node \
  /mnt/c/CodexShared/Projetos/skincos/scripts/github/export-repository-transfer-inventory.mjs \
  --repo jubenitogarcia/skincos \
  --output /mnt/c/CodexRuntime/operator/admin/skincos/github-transfer/pre-transfer-inventory.json
```

Anexe o resumo sanitizado ao ticket administrativo e preserve o JSON privado
como evidência. Compare Actions, secrets, variables, environments, rulesets,
webhooks e permissões diretas imediatamente antes da transferência.

## Checklist administrativo mínimo

1. Criar a Organization privada escolhida e confirmar que ela pode criar o
   repositório `skincos`.
2. Convidar e confirmar **dois owners distintos**. Não conte convite pendente
   como owner; registre as duas confirmações no ticket privado.
3. Criar os times do plano: `skincos-platform`, `skincos-crm`,
   `skincos-finance`, `skincos-workforce`, `skincos-inventory`, `skincos-web`
   e `skincos-security`. Conceder somente as permissões previstas no plano.
4. Criar `staging`, `production`, `preview`, `recovery` e `copilot` no destino;
   separar secrets/variables por environment e configurar branches protegidas.
   Não copie valores para Git, logs ou ticket.
5. Exportar o ruleset atual e manter o arquivo JSON versionado de ruleset como
   referência. No destino, importar primeiro como `evaluate` quando o plano
   permitir e ativar somente após o preview sem deploy.
6. Registrar os pontos de integração que usam `jubenitogarcia/skincos`:
   Actions, GitHub Apps, webhooks, badges, Cloudflare/CI callbacks, clones de
   operadores e qualquer configuração `owner/repo` fora do Git.
7. Congelar apenas alterações administrativas durante a janela. São proibidos
   deploy de produção, migration de banco, mudança de feature flag e ativação de
   piloto.

## Transferência e rollback administrativo

A pessoa que transfere precisa ser administradora do repositório de origem e
ter permissão para criar repositórios na Organization de destino. Faça a
transferência pela interface GitHub, mantendo o nome `skincos`.

Se a verificação abaixo falhar antes de qualquer ação operacional, suspenda a
janela. Transfira de volta somente se o nome original continuar disponível;
caso contrário, mantenha o repositório privado de destino, restaure os remotes
para a URL confirmada e resolva a indisponibilidade administrativa sem recriar
um repositório paralelo.

## Verificação pós-transferência

1. Atualizar o remoto de cada clone para `https://github.com/<organization>/skincos.git` e
   confirmar `git fetch --prune` e `git remote -v`.
2. Substituir o owner único em `.github/CODEOWNERS` pelos times do blueprint,
   usando o slug real da Organization; abrir uma PR só para essa substituição.
3. Confirmar repositório privado, dois owners, permissões dos times e que o
   ruleset de `main` bloqueia force-push e exclusão.
4. Confirmar pinagem SHA de Actions e os environments protegidos sem misturar
   secrets de staging e produção.
5. Rodar CI da `main` e comparar o novo inventário privado com o pré-transfer.
6. Executar somente um preview que não publique artefatos nem altere recursos.
   Não use workflows de staging/produção como substituto desse preview.
7. Validar callbacks, GitHub Apps e integrações externas por health/read-only
   checks. Não reautorize, rotacione ou altere secrets sem uma mudança separada.

## Estado desta preparação

A transferência não está autorizada enquanto faltarem o slug da Organization e
o segundo owner. O piloto Financeiro também permanece pré-requisito para a
auditoria final do ciclo empresarial; essa auditoria não é executada por este
runbook.

Referências: [transferência de repositório](https://docs.github.com/en/enterprise-cloud@latest/repositories/creating-and-managing-repositories/transferring-a-repository),
[rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) e
[secrets de Actions](https://docs.github.com/en/actions/concepts/security/secrets).
