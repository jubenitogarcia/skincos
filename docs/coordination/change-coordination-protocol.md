# Protocolo de coordenação de mudanças concorrentes

Este protocolo evita que duas tarefas alterem, revertam ou publiquem a mesma
superfície sem perceber. Ele complementa a
[política operacional](../decisions/operational-change-policy.md): em conflito,
vale a regra mais restritiva.

## Regra central

Cada mudança tem um objetivo único, um worktree isolado e um único registro
ativo no registry privado do operador. Antes de editar ou mutar uma superfície
compartilhada, a tarefa precisa reivindicá-la. Uma reivindicação de escrita é
exclusiva até handoff ou encerramento.

O registry é deliberadamente privado e local:

`C:\CodexRuntime\operator\admin\skincos\change-coordination\active-changes.json`

Ele contém somente metadados operacionais (IDs, caminhos, commits, owners e
estado); nunca tokens, conteúdo de payload, dados de clientes ou cookies. A
estrutura versionada de referência está em
[`active-changes.example.json`](active-changes.example.json), e o modelo de
registro em [`change-record.template.json`](change-record.template.json).

## Superfícies que precisam de ownership

Registre cada superfície que a mudança pode escrever. Use IDs estáveis e
específicos:

| Kind | ID recomendado | Exemplo |
| --- | --- | --- |
| `source` | caminho relativo ou módulo | `orb/engine/workflows/meta-ads-publish` |
| `workflow` | `n8n:<workflow-id>` | `n8n:eFJhFg79lyaycjlm` |
| `worker` | serviço ou Worker | `token-vault-worker` |
| `database` | banco e migration/escopo | `d1:crm-production:0018` |
| `deployment` | alvo de promoção | `cloudflare:crm:staging` |
| `runtime` | serviço nativo | `systemd:orb.service` |
| `credential` | somente nome/escopo, nunca valor | `n8n:meta-ads-token-vault` |

Dois registros ativos não podem reivindicar escrita no mesmo ID. Para `source`,
um caminho pai também conflita com qualquer subcaminho. Leitura compartilhada é
permitida, mas não autoriza salvar, publicar, migrar ou alterar uma credencial.

## Fluxo obrigatório

1. Atualize a base e crie um worktree pelo comando padrão. Não use a checkout
   compartilhada para editar.
2. Verifique o registry e crie o seu claim antes da primeira mutação. O commit
   de base deve ser o que foi realmente inspecionado.
3. Declare todas as superfícies de escrita e o rollback. Para workflow, banco,
   Worker, deployment, runtime ou credencial, registre também o baseline vivo
   no checkpoint privado antes de salvar qualquer mudança. O baseline da
   superfície contém `version`, `observed_at` e `checkpoint_ref`; o validador
   rejeita a ausência desses três campos.
4. Se a mudança atravessar duas ou mais superfícies com contrato comum (por
   exemplo workflow + Token Vault Worker), inclua um `contract_bundle` com as
   superfícies e o comando de compatibilidade. Nenhum lado é publicado sozinho.
5. Antes da mutação externa, confirme que o baseline vivo ainda é o registrado.
   Divergência, registry inválido, claim de outra tarefa ou worktree inesperadamente
   sujo são condições de parada: sincronize ou faça handoff, sem sobrescrever.
6. Faça a alteração mínima, execute a validação declarada e registre o estado
   real: `validated`, `integrated`, `deployed`, `blocked` ou `cancelled`.
7. Faça handoff ou libere o claim somente depois de registrar SHA/checkpoint,
   testes, superfícies alteradas, rollback e pendências. O histórico permanece
   no registry privado.

Estados ativos são `planned`, `in_progress`, `blocked` e `handoff`. Estados
terminais são `validated`, `integrated`, `deployed` e `cancelled`.

## Comandos

No primeiro uso nesta máquina, inicialize o registry privado. Execute os
comandos dentro do Ubuntu WSL, no diretório do worktree (o runtime Node
suportado do projeto):

```bash
npm run coordination:registry:init
```

Crie um registro privado a partir do template e reivindique-o:

```bash
node ./scripts/coordination/change-registry.mjs claim --record /mnt/c/CodexRuntime/operator/admin/skincos/change-coordination/records/meta-ads-payload.json
```

Valide o registry e confirme ownership imediatamente antes de uma mutação:

```bash
npm run coordination:registry:validate
node ./scripts/coordination/change-registry.mjs assert --change meta-ads-payload --surface workflow:n8n:eFJhFg79lyaycjlm
```

Encerre preservando o histórico:

```bash
node ./scripts/coordination/change-registry.mjs release --change meta-ads-payload --status validated --summary "Preflight verde; nenhuma publicação executada."
```

`npm run coordination:contract:validate` valida o formato versionado no
repositório; `npm run coordination:test` cobre colisão, rollback e bundles.

## Handoff mínimo

O handoff é um registro no ticket/PR e no `summary` do release, contendo:

- change ID, owner anterior e próximo owner;
- branch, worktree, SHA de base e SHA atual;
- superfícies revendicadas e seu baseline vivo/checkpoint;
- alteração aplicada e compatibilidade entre superfícies;
- validações realizadas, resultado e limitações;
- rollback exato e condição que o dispara;
- estado (`handoff` ou terminal) e próxima ação.

Um handoff não transfere uma superfície silenciosamente: o próximo owner
reivindica o registro atualizado e valida novamente antes de escrever.
Os IDs de change não são reutilizados: o encerramento preserva o registro no
histórico privado para manter a trilha de decisão inequívoca.

## Regras específicas para Orb/n8n

- A definição atual salva no editor n8n é a fonte da verdade. Exporte-a antes
  de editar e reexporte depois de salvar; um JSON de snapshot não autoriza
  sobrescrever o workflow vivo.
- Um workflow e seus Workers/gateways dependentes formam um `contract_bundle`.
  Ambos precisam de baseline, fonte sincronizada e teste de compatibilidade
  antes de qualquer publicação.
- Execuções, preflights e readbacks são evidência de ambiente, não substituem
  o claim. Nenhuma tarefa usa execução manual de n8n ou publicação Meta para
  descobrir se outro trabalho estava correto.

## Limites de evidência

Um claim evita colisão de intenção entre tarefas que seguem o protocolo. Ele não
prova que uma versão esteja em produção, que o browser tenha um draft não salvo
ou que uma integração externa tenha aceitado uma mudança. Esses fatos continuam
exigindo checkpoint, validação e evidência conforme a política operacional.
