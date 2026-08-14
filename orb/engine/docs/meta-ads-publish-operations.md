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
   versão runtime. Cada Code node tem uma fonte em
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
`platform/security/token-vault/src/meta-ads-publish.js`. A promoção canônica é
`.github/workflows/deploy-token-vault.yml`: Preview testa/dry-run, Staging
exerce uma reconciliação e rollback reais numa fixture sintética, e Production
requer a source release nativa exata, aplica o Orb inativo por versão esperada,
ativa então o Worker e roda o preflight final. Não publique Worker e Orb por
canais separados ou em ordem inversa.
O Worker declara a mesma `WORKFLOW_CONTRACT_REVISION` que `Build Jobs`,
`Validate Meta Creative Payload` e `Build Meta API Params From Vault`. Este
último nó falha fechado se a capacidade recebida divergir; uma alteração de
contrato exige atualizar os quatro produtores/consumidores, a definição
canônica, o checkpoint de run e o preflight na mesma revisão.

Antes do primeiro deploy em um ambiente, aplique as migrations do Token Vault
pelo publicador governado. As migrations
`0002_meta_ads_publish_journal.sql` e
`0003_meta_ads_publish_tracking_reconciliation.sql` versionam o journal,
locks idempotentes e snapshots cifrados usados pela reconciliação, inclusive os
valores de tracking e as chaves que uma reversão pode tocar.

## Conversão e parâmetros de URL

- `url_tags` pertence ao `AdCreative`; Pixel, evento e dataset offline
  pertencem ao `AdSet.promoted_object`. Para Website, o fluxo primeiro valida
  o creative e depois reconcilia o ad set autorizado via Graph `GET` ->
  `POST` somente quando necessário -> `GET` de confirmação. A publicação
  falha fechada se Pixel, um único evento/conversão personalizada ou o dataset
  offline exigido pelo perfil não forem confirmados. Perfis Website cujo
  objetivo não exige conversão declaram `website_event_requirement=not_required`
  e seguem pela mesma atestação sem forçar Pixel/evento em campanhas existentes.
- A configuração privada no Token Vault declara um `profile_ref` e mantém
  somente ali o `source_adset_id` autorizado. O workflow recebe apenas o
  perfil, os requisitos, fingerprints sanitizados e `url_tags`; nunca IDs de
  Pixel, conversão ou dataset. A reconciliação só altera os campos de tracking
  permitidos e preserva os demais campos do `promoted_object` do conjunto já
  existente. Um snapshot cifrado registra apenas as chaves de tracking que a
  operação mudou; o rollback compara essas chaves, preserva mudanças
  concorrentes em catálogo/outros campos e falha se o tracking tiver drift.
- `tracking_contract.url_tags` é um fragmento de query bruto, sem `?` ou `#`,
  formado por pares arbitrários `chave=valor` separados por `&`, por exemplo
  `key1=value1&key2=value2`. UTM é aceito normalmente, mas não é obrigatório.
  O fragmento é validado e transportado literalmente para `AdCreative.url_tags`;
  o fluxo não usa decodificação nem `URLSearchParams`, portanto `%20` não vira
  `%2520`. O separador é o primeiro `=` de cada par, portanto valores válidos
  podem conter `=` (por exemplo, padding de base64) sem alterar o fragmento.
- Cada mutação de creative ou stage exige a revisão estável v20 do Token Vault,
  o destino, o ad set e o perfil autorizados e, para Website, o mesmo
  `url_tags` bruto configurado privadamente. Antes do stage o Token Vault lê de
  novo o creative e o ad set; se qualquer um divergir, não cria nem altera o
  anúncio. Um route de carrossel nativo só é aceito quando está explicitamente
  verificado/ativo e, para Website, quando o perfil privado também autoriza o
  seu `carousel_native_adset_id` exato.
- Destinos WhatsApp permanecem `not_applicable`: o fluxo não infere Pixel,
  dataset offline ou `url_tags`, não faz chamada de reconciliação e não troca
  objetivo ou otimização por causa de uma configuração de site.
- Vincular o dataset offline ao ad set seleciona a otimização da Meta; a
  ingestão dos eventos offline continua sendo responsabilidade do emissor CAPI
  ou da integração offline apropriada e deve ter sua própria evidência.
- Para diagnosticar o estado atual sem mutar a Graph, rode no runtime Orb que
  possui a credencial privada
  `scripts/run-meta-ads-conversion-contract-readback.sh`. A rotina abre um
  run técnico isolado, executa `read_adset_conversion_contract` (Graph `GET`)
  para os dois destinos e, para cada Website, lê o creative pausado de fixture
  privado via `read_authorized_creative_url_tags_contract` (também somente
  Graph `GET`). A fixture e seus IDs ficam apenas no Token Vault; o resultado
  expõe somente booleans de requisito/configuração e não contém IDs, URLs,
  parâmetros ou tokens.

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
- Advantage+ possui duas evidências Graph por criativo: a leitura após a
  estabilização inicial e outra 30 segundos após a ativação, antes de encerrar
  o run. Ambas usam `get_creative` (Graph `GET`) e não criam, alteram, ativam,
  republicam ou revertem recursos.
- A segunda leitura registra `unchanged_graph_state_ui_unverified`,
  `graph_state_drift_detected` ou `unavailable`. Essas categorias descrevem
  apenas o que a Graph reporta em `creative_features_spec`; não comprovam o
  estado exibido no Ads Manager e não acionam remediação automática.
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

## Evidência de encerramento — 2026-07-29

- A última execução comercial bem-sucedida é a manual `333`, concluída em
  2026-07-28T16:38:07Z. Ela concluiu o run idempotente
  `map_f6a59341d6dace99d70f5533`, iniciado na execução `331` e retomado pela
  `333` sem recriar recursos.
- O lote criou e ativou um anúncio por unidade: BarraShoppingSul
  `120247386191180157` / criativo `1011986138341232` e Novo Hamburgo
  `120247386191560157` / criativo `1400344355311942`. O readback da execução
  confirmou o contrato `OUTCOME_LEADS` + `WHATSAPP_MESSAGE` e o handoff
  `https://api.whatsapp.com/send`; as URLs de agendamento permanecem apenas
  como referência por unidade.
- A definição atualmente viva é a versão `830`
  (`b22ba74a-4fc9-428e-aa4e-41aebfd5b3f0`; schema SHA-256
  `87e82f8d7c89afbe97b6057d1a417013a37e7a2b6227ba14315c4e869e7ce62f`),
  inativa/manual. Ela foi aplicada
  versionadamente a partir da exportação canônica; o checkpoint privado da
  versão `825` permanece como rollback operacional.
  O Token Vault ativo é o deployment
  `beba53d9-67f3-495b-a002-5dc579463c29`; o checkpoint privado anterior é o
  rollback operacional.
- O source release nativo do Orb está em
  `a32cf1a9034ccd4872cfbde1ae089e56355300c4` (merge da PR #854), descendente
  do release `0c0a4fa0f4c2d0b432d449c0ba154e093b3ffe89`. A promoção usou
  archive verificável, lineage, drenagem e troca atômica; Orb, proxy, CRM e
  Booking executam essa mesma release. Rollback permanece uma nova promoção
  descendente/revertida a partir do checkpoint privado.
- O run final tem Drive verificado, stage/activate completos e nenhum lock
  ativo. Telegram foi preservado como ramo independente. A notificação
  WhatsApp passou a usar HTTP direto para a Evolution no loopback, com instância
  e destinatário específicos do Meta Ads em configuração privada. A correção
  eliminou CRLF no ambiente, usa timeout e retentativas limitadas, e foi
  validada sem executar o workflow nem chamar a Meta: o provedor persistiu a
  mensagem sintética e devolveu `DELIVERY_ACK`. Isso comprova entrega pelo
  provedor, não leitura humana.
- A auditoria histórica está em
  `docs/meta-ads-publish-historical-run-audit-2026-07-29.md`. Os três runs
  anteriormente staged receberam lookup Graph somente leitura, com anúncios
  comprovadamente `ARCHIVED`, e foram fechados como `rolled_back` com evento
  imutável. O estado atual é 110 runs terminais, zero locks ativos, jobs não
  terminais e `reconciliation_required`; nenhuma ação Meta foi feita na
  reconciliação.
