# Meta Ads - Publish: operação e diagnóstico

## Preflight

Use `Orb > Meta Ads Publish Preflight` no Codex App antes de concluir uma
correção ou iniciar uma publicação controlada. O comando é somente leitura:
ele não reinicia serviços, não salva o workflow e não chama a Meta.

O preflight confirma a saúde local e pública do Orb, o schema estruturado, a
versão que será executada e a sincronização entre os Code nodes live e os
arquivos em `workflow-src/meta-ads-publish/`.

## Fonte de verdade

1. Para uma falha, inspecione primeiro a execução real. O runtime preserva
   sucessos, erros, execuções manuais e progresso por nó por 720 horas, até o
   teto de 5.000 execuções. Se uma execução não aparecer, audite PostgreSQL,
   `deletedAt` e runners antes de atribuir o problema a permissões do usuário.
2. Para código, trate `workflow-src/meta-ads-publish/` como fonte editável e
   compare-o com o workflow live usando o preflight. Não conclua a correção por
   nomes de nodes ou por uma aba antiga do navegador.
3. Para runtime, valide `/var/lib/skincos-runtime/orb` e os serviços finais; o
   `Orb Validate` é a verificação ampla após alterações de infraestrutura.
4. A definição rastreada é `workflows/meta-ads-publish.current.json`. Ela é
   uma exportação sanitizada: não inclui execução, pin data, contadores nem
   versão runtime. Cada um dos 49 Code nodes tem uma fonte em
   `workflow-src/meta-ads-publish/`, listada uma única vez em
   `scripts/lib/meta-ads-publish-code-sources.js`.

## Sincronização e rollback

1. Exporte o workflow vivo para o checkpoint privado com
   `node scripts/export-meta-ads-publish-live.js`.
2. Gere a definição revisável com
   `node scripts/export-meta-ads-publish-canonical.js <checkpoint>/workflow.live.json workflows/meta-ads-publish.current.json`
   e extraia/compare todos os Code nodes com
   `node scripts/sync-meta-ads-publish-sources.js check`.
3. Aplique uma alteração somente a partir da definição canônica, com
   `apply-meta-ads-publish-workflow-snapshot.js`, usando a versão viva esperada;
   o script recusa workflows ativos e mudanças concorrentes.
4. Para rollback, use o checkpoint privado anterior como candidato, confirme a
   versão viva atual e execute o mesmo apply versionado. Nunca copie código do
   editor, de um worktree antigo ou de uma execução para a produção.

O Token Vault é uma superfície separada: o arquivo canônico é
`platform/security/token-vault/src/meta-ads-publish.js`. Antes de promover uma
versão do Worker, execute seus testes e registre o ID/ETag retornado pelo
Wrangler; depois compare a versão de produção e rode o preflight do workflow.
O Worker declara a mesma `WORKFLOW_CONTRACT_REVISION` que `Build Jobs`,
`Validate Meta Creative Payload` e `Build Meta API Params From Vault`. Este
último nó falha fechado se a capacidade recebida divergir; uma alteração de
contrato exige atualizar os quatro produtores/consumidores, a definição
canônica, o checkpoint de run e o preflight na mesma revisão.

Antes do primeiro deploy em um ambiente, aplique as migrations do Token Vault
com `npm run d1:migrate`. A migration `0002_meta_ads_publish_journal.sql`
versiona o journal, operações e locks idempotentes já usados pelo gateway.

## Regras que evitam recorrência

- O node OpenAI `typeVersion >= 1.3` usa Responses API por padrão. A ausência
  de `responsesApiEnabled` no JSON significa o valor padrão `true`; somente
  `false` explícito é uma falha.
- Workflows inativos executam a versão atual; workflows ativos usam sua versão
  publicada. Compare a versão de execução, não apenas `activeVersionId`.
- O link principal de anúncios Click-to-WhatsApp é controlado pelo workflow e
  aponta para `https://api.whatsapp.com/send`. A IA não escolhe esse destino.
  Links opcionais do Advantage+ continuam sujeitos à allowlist.
- Não publique na Meta para diagnosticar uma falha. Reproduza com testes e
  finalize com o preflight; uma rodada live exige autorização explícita.
- Tokens de provedor não podem entrar nos itens do workflow. Meta Ads, Livia e
  Token Manager usam endpoints allowlisted do Token Vault com credencial n8n
  criptografada; `/v1/tokens` é uma interface exclusivamente administrativa.
- O community node Cloudinary deve permanecer com o boundary de saída aplicado
  por `service:patch-cloudinary-output`; `service:validate` falha se uma
  atualização do pacote voltar a expor `api_key` no histórico da Livia.
- `service:audit-executions` reporta execuções `running` há mais de seis horas,
  mas nunca as encerra automaticamente. Confirme a ausência de runner antes de
  reparar uma execução órfã.

## Critério de aceite

Uma correção está pronta somente quando há: causa baseada em execução/runtime,
teste que reproduz o cenário, fontes sincronizadas com o live, preflight verde
e uma declaração clara sobre o que não foi validado em produção.
