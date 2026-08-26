# Cartas da Beleza em Movimento — operação de campanha

Este módulo é deliberadamente desligado por padrão (`BEAUTY_MOVEMENT_ENABLED=false`).
Ele não deve receber lista real, publicar rota ativa ou criar mensagens até que todos os
gates abaixo estejam concluídos.

## Dados e privacidade

- A planilha de entrada fica somente no runtime privado do operador, em
  `C:\CodexRuntime\operator\admin\skincos\beauty-movement\` (ou equivalente
  privado no ambiente de release). Não copie CSV, URLs de entrega, CPF, histórico
  ou relatórios para este repositório.
- Para a lista final, o importador aceita o formato mínimo `NOME,TELEFONE` e as
  colunas opcionais `EMAIL,PRÊMIO`. Quando `PRÊMIO` está presente, ele é a
  atribuição autoritativa do convite: `Velocity` representa a aula-cortesia e os
  quatro rótulos comerciais canônicos representam a oferta correspondente.
  Não é necessário pré-preencher identificador, paleta, expiração ou status.
  CPF, procedimentos, histórico clínico e colunas não reconhecidas são
  rejeitados antes de qualquer escrita.
- A paleta apenas escolhe o deck editorial; ela não escolhe nem pré-reserva a
  oferta. Nenhum dado pessoal, procedimento ou histórico clínico é enviado ao
  D1 ou ao navegador para decidir o resultado.
- Para convites da lista final, a condição/prêmio é propriedade da atribuição
  privada do convite. As três cartas são uma leitura simbólica pré-configurada;
  qualquer clique válido mantém a mesma promessa e o servidor persiste o
  outcome atribuído. `reward_id` é opcional e só mantém compatibilidade com
  convites legados. O resultado persistido inclui `outcome_key`, versão do
  protocolo e snapshot estruturado da oferta.

## Isolamento de sessão por convite

A identidade da experiência não é selecionada por um cookie global. O fragmento
`#c=...` é capturado e removido antes de analytics; o servidor o troca por:

- um `contextRef` opaco e não secreto, derivado por HMAC em domínio separado;
- um cookie HttpOnly exclusivo chamado `ef_bm_ctx_<contextRef>`, com
  `Path=/api/beleza-em-movimento`, `SameSite=Lax`, `Secure` em produção e
  validade máxima de 24 horas.

Cada entrada do histórico da aba guarda somente seu `contextRef`. Um marcador
limitado em `sessionStorage` auxilia a limpeza, mas o histórico é a seleção
autoritativa por navegação. Todas as chamadas de estado, escolha e confirmação
enviam `X-Beauty-Movement-Context`; o servidor aceita a requisição apenas
quando existe o cookie HttpOnly com o mesmo sufixo e quando o HMAC recalculado
do token secreto coincide em tempo constante. O token da sessão nunca é
entregue ao JavaScript.

O cookie legado `ef_beauty_movement_session` é ignorado por todas as leituras
e mutações, e é expirado durante uma troca de convite ou resposta inválida.
Uma visita sem fragmento e sem contexto ligado àquela entrada do histórico
falha fechada e retorna ao site institucional. Um token novo, inválido,
expirado ou revogado nunca herda o convite que outra aba abriu.

Não há migration de D1 nesta mudança. Convites, escolhas, confirmações e
outcomes existentes continuam vinculados ao mesmo `invite_id`; reabrir o link
personalizado cria apenas uma nova sessão privada e retoma o progresso já
persistido. Apagar campanha, convites ou banco não faz parte de rollback nem de
compatibilidade.

### Threat model resumido

- **Confusão entre abas:** mitigada por contexto explícito em cada entrada do
  histórico e cookies separados por contexto.
- **Contexto forjado ou trocado:** rejeitado porque o servidor recalcula o HMAC
  do token HttpOnly e exige correspondência exata.
- **Vazamento do convite:** o fragmento é removido sincronicamente, não entra em
  URL de API, evidência, analytics ou logs.
- **Resposta atrasada A após navegação B:** inicializações usam cancelamento e
  geração monotônica; o componente também é remontado quando o contexto muda.
- **Back/forward e bfcache:** `popstate` e `pageshow` revalidam o contexto
  selecionado antes de restaurar a experiência.
- **Storage indisponível:** o handoff em memória e o histórico mantêm o fluxo;
  na ausência de ambos, o comportamento é fail-closed.
- **Cookie legado ou obsoleto:** não seleciona sessão e tem expiração limitada;
  os cookies por contexto expiram naturalmente em até 24 horas para preservar
  abas concorrentes.

## Infraestrutura exigida antes de staging

1. Criar um D1 exclusivo de staging e outro de produção, sem reutilizar
   `BOOKING_DB`, e configurar a binding `BEAUTY_MOVEMENT_DB` para cada ambiente.
   Os IDs não são versionados porque ainda não existem neste repositório.
2. Configurar chaves diferentes por ambiente: `BEAUTY_MOVEMENT_TOKEN_HMAC_KEY`
   e `BEAUTY_MOVEMENT_PII_KEY`. Nenhum valor é versionado.
3. Configurar `BEAUTY_MOVEMENT_ALLOWED_ORIGINS` com a origem exata do ambiente.
4. Declarar `migrations_dir = "migrations/beauty-movement"` na binding dedicada
   e aplicar as migrations `0001_initial.sql`, `0002_rewards.sql` e
   `0003_reward_integrity.sql`, `0004_card_outcomes.sql` e
   `0005_invite_assignments.sql` pelo mecanismo oficial do Wrangler. O helper
   local executa `wrangler d1 migrations apply --local`; nunca aplique os SQLs
   manualmente em sequência, pois a segunda migration possui alterações
   aditivas. Registrar checkpoint/export e validar schema. Rollback operacional
   é desativar a campanha, não apagar convites.
5. Manter `BEAUTY_MOVEMENT_ENABLED=false` até o smoke sintético passar.

## Importação privada

O comando abaixo deve rodar por meio do wrapper WSL e com caminhos fora do
worktree. Sem `--apply`, ele só valida e produz contagens redigidas.

```text
npm run beauty-movement:import -- --dry-run --input <caminho-privado>
  [--reward-catalog <json-privado> --procedure-catalog <json-privado>]
  --campaign <id> --campaign-config <json-privado>
  --campaign-ends-at <ISO-8601>
```

Uma escrita exige, além de uma validação limpa, `--apply`, alvo explícito
(`--local` somente para dados sintéticos ou `--remote` somente no ambiente
aprovado), `--confirm-campaign <id>`, database e diretório privado. A saída com
links de entrega deve ir para diretório privado; nunca para `website/tmp`, Git
ou logs de CI.

A primeira carga também exige um JSON privado de configuração da campanha. Ele
mantém o conteúdo editorial e as condições fora da lista de contatos e permite
ao importador criar apenas uma campanha em rascunho completa. Os campos exigidos
são `title`, `description`, `invitationTitle`, `invitationText`, `partnerName`,
`whatsappMessageCourtesy`, `whatsappMessageCommercial`, `whatsappLabel`,
`conditionsLabel`, `conditionsText`, `velocityBenefitLabel` e
`velocityBenefitText`; pode incluir `startsAt` em ISO-8601. O importador não ativa a campanha e não altera
o conteúdo de uma campanha já ativa. A ativação é uma etapa manual, revisada e
posterior ao smoke sintético.

O relatório operacional é privado e exige alvo explícito (`--local` para dados
sintéticos ou `--remote` para o ambiente aprovado), confirmação do identificador
e a chave de PII para descriptografar somente o CSV de saída. Não existe endpoint
público ou painel administrativo para essa consulta. O relatório não consulta
nem mostra cartas individuais.

Um convite marcado como `revoked` permanece revogado mesmo se o mesmo
`invite_ref` voltar em uma reimportação. Para entregar novo acesso após uma
revogação, crie um novo `invite_ref` sob o fluxo privado aprovado; não reutilize
o link anterior.

## Roteiro local sintético

Use uma configuração privada de Wrangler com um D1 local dedicado e
`migrations_dir` apontando para `migrations/beauty-movement`. Nunca reutilize
`BOOKING_DB`, um ID remoto ou dados reais nesta etapa.

```text
npm run beauty-movement:migrate:local -- --database <d1-sintetico>
  --config <wrangler-privado>

npm run beauty-movement:import -- --apply --local ...
  --database <d1-sintetico> --config <wrangler-privado>
  --out-dir <diretorio-privado>

npm run beauty-movement:report -- --local --database <d1-sintetico>
  --campaign <id> --confirm-campaign <id>
  --config <wrangler-privado> --out-dir <diretorio-privado>
```

O importador gera um arquivo SQL privado sem `BEGIN`/`COMMIT` explícitos: o
Wrangler envia o arquivo ao D1 como batch atômico, comportamento que também
funciona no runtime local. Se o batch falhar, não publique links de entrega nem
repita a carga sem inspecionar o resumo privado.

## Evidência de auditoria local em 2026-08-06

- migrations aplicadas duas vezes no mesmo D1 sintético sem reaplicar schema;
- probe de batch com instrução final inválida confirmou rollback integral;
- dry-run completo validou duas linhas sintéticas;
- importação local registrou um cuidado gratuito e uma condição percentual;
- após confirmar sinteticamente uma única linha, o relatório privado retornou
  exatamente essa linha confirmada, sem coluna de cartas; a linha não confirmada
  não foi exportada;
- trigger de D1 recusou uma tentativa de combinar recompensa e paleta de famílias
  diferentes;
- uma revalidação independente criou outro D1 local sintético, reaplicou as
  migrations, carregou duas linhas, confirmou sinteticamente uma delas e gerou
  relatório de uma única linha confirmada; a tentativa de alterar a família de
  recompensa já referenciada foi bloqueada pelo trigger e a família original
  permaneceu preservada;
- em volume Windows/WSL, permissões POSIX aparentam `777`; a restrição efetiva
  é a ACL NTFS herdada do runtime privado, limitada a `Administrators`, `SYSTEM`
  e ao operador `admin`;
- nenhuma credencial, CSV real ou D1 remoto foi utilizado.

## Checklist de publicação

- [ ] Logo/uso público da Velocity confirmado e fornecido como ativo aprovado.
- [ ] Número de WhatsApp de Novo Hamburgo confirmado.
- [ ] Datas, encerramento, texto, validade, regras e versão das condições
      comerciais aprovados para a planilha sanitizada.
- [ ] Catálogo privado de recompensas aprovado por família, com procedimento
      canônico, tipo de desconto e `approvedAt`.
- [ ] CSV Velocity contém somente nome e WhatsApp, com e-mail/prêmio opcionais;
      quando presente, o prêmio é `Velocity`. `reward_id` e demais campos
      técnicos são derivados pelo importador. Nenhum procedimento, CPF ou
      histórico clínico foi incluído.
- [ ] O CSV privado de entrega gerado contém nome, telefone e URL opaca para o
      envio manual no WhatsApp; ele permanece fora do repositório.
- [ ] Gate de privacidade concluído para qualquer origem de paleta baseada em
      dados pré-existentes.
- [ ] Migration e smoke com convites sintéticos concluídos em staging.
- [ ] Rate limits de borda sincronizados e verificados.
- [ ] Campanha criada inicialmente como `draft`, com data de encerramento e
      plano de retenção de 90 dias registrados; ativação ainda depende da
      revisão de release.
- [ ] Flag server-side ativada somente para a janela aprovada.

## Rollback e retenção

Para parar a ação sem novo deploy, marque a campanha como `disabled` ou revogue
o lote de convites. Preserve registros pelo período da campanha + 90 dias e só
então execute a eliminação ou anonimização aprovada. O rollback de Worker usa a
versão anterior comprovada; ele não substitui a preservação de dados da
campanha.

## Gate oficial de produção

A ativação real não deve ser feita pelo deploy genérico nem por um comando local
que altere a flag. O fluxo oficial é o workflow versionado
`.github/workflows/beauty-movement-production-activation.yml`, executado com
`release_sha` exato e o `staging_run_id` que produziu a evidência de promoção do
mesmo SHA. O workflow rejeita SHA divergente, D1/Worker fora de produção,
migrations pendentes, campanha já existente, campanha ativa concorrente e ausência
de qualquer um dos dois secrets do Worker. Ele não executa `wrangler secret
put`: a presença é verificada por nome e os valores são preservados.

### Custódia do pacote real

O runner hospedado não enxerga `C:\CodexRuntime\...` do operador. Para a
execução oficial, materialize os arquivos como secrets protegidos do GitHub
Environment `production`, sem incluí-los em inputs, artefatos públicos, issues,
logs ou commits:

- `BEAUTY_MOVEMENT_PRODUCTION_INVITES_CSV` — CSV sanitizado;
- `BEAUTY_MOVEMENT_PRODUCTION_CAMPAIGN_JSON` — copy, datas, condições e CTA;
- `BEAUTY_MOVEMENT_PRODUCTION_REWARDS_JSON` e
  `BEAUTY_MOVEMENT_PRODUCTION_PROCEDURES_JSON` — opcionais, mas sempre em par
  quando `reward_id` legado for usado.

Os secrets de pacote são escritos somente em arquivos `0600` dentro de
`RUNNER_TEMP`, validados pelo `beauty-movement:import --dry-run` e removidos
com o runner. Seus valores nunca são impressos. Se esses secrets ainda não
existirem no Environment, o workflow falha antes de qualquer escrita remota;
não há fallback para caminho local, chat ou outro checkout.

### Sequência e compensação

1. A promoção reutiliza a cadeia `preview → staging → production` e verifica as
   migrations `0004_card_outcomes.sql` e `0005_invite_assignments.sql`,
   incluindo as colunas/índices de outcomes e da atribuição autoritativa em D1.
2. O pacote é importado como `draft`; um readback confirma o identificador novo
   e a quantidade de convites antes de qualquer deploy.
3. O workflow captura a versão Worker incumbente, compila o SHA promovido,
   publica a mesma fonte com `BEAUTY_MOVEMENT_ENABLED=true` e exige
   `x-app-build` igual ao SHA antes de ativar a campanha.
4. Uma campanha sintética isolada é criada para o smoke de navegador. Quatro
   convites sintéticos cobrem a jornada completa, A/B concorrentes e token
   expirado. A matriz valida mesma aba, duas abas, contexto privado,
   armazenamento indisponível, troca rápida, reload simultâneo, back/forward,
   os dois aliases, autorização cruzada e fail-closed. O readback em D1 prova
   escolhas independentes; a jornada principal ainda confirma `outcome_key`,
   snapshot, protocolo e timestamp, com zero chamadas WhatsApp/erros de console.
5. A fixture sintética é revogada/desabilitada sempre. Se qualquer etapa não
   puder ser atestada, a campanha real desta execução é desabilitada e o Worker
   volta somente para a versão incumbente capturada; nenhum dado preexistente é
   apagado.

Em sucesso, a campanha real permanece ativa durante a janela aprovada e a flag
continua explicitamente habilitada apenas na versão atestada. Em falha, o estado
terminal esperado é `BEAUTY_MOVEMENT_ENABLED=false` e API `503`.

### Continuidade durante deploys posteriores

O deploy genérico não cria, importa ou ativa campanhas. Porém, enquanto existir
uma campanha de produção vigente no D1, ele consulta esse estado antes de
publicar e mantém `BEAUTY_MOVEMENT_ENABLED=true` somente na versão que está
sendo publicada. Se não houver campanha vigente, o padrão continua sendo
`false`. A consulta é feita sem exibir dados de convites; qualquer falha em
provar o estado ativo interrompe o deploy antes da publicação. Assim, um deploy
posterior de código não desliga acidentalmente uma campanha já aprovada nem
reativa uma campanha encerrada.

Quando essa continuidade está ativa, o deploy genérico também registra em
`RUNNER_TEMP` a versão Worker anterior, a versão candidata e o build anterior
atestados. O checkpoint incumbente é persistido em artefato privado antes da
mutação e a identidade candidata é persistida imediatamente após o Wrangler
confirmar a nova versão, antes de qualquer smoke. A versão recebe ainda uma tag
de propriedade limitada ao `run_id` e `run_attempt`; isso diferencia até dois
deploys distintos do mesmo SHA. Antes de promover os demais Workers, ele executa em produção a
mesma matriz A/B e uma jornada completa usando uma campanha temporária com
quatro convites exclusivamente sintéticos. O teste prova os dois aliases,
`x-app-build`, assets, headers `no-store`, abas concorrentes, reload,
back/forward, autorização cruzada inclusive com a credencial A deliberadamente
colocada sob o nome de cookie B, três escolhas, confirmação, outcome e a
presença do CTA sem abrir o WhatsApp. A fixture é sempre revogada e
desabilitada, e o número de campanhas reais ativas deve permanecer idêntico ao
baseline. Em qualquer falha, o workflow só aceita rollback se o Worker corrente
ainda for exatamente a versão candidata; então retorna à versão e ao
`x-app-build` incumbentes. A campanha real, seus convites, shortlinks e progresso
não são recriados nem alterados por esse smoke.

A compensação tem duas camadas idempotentes. Uma etapa `always()` no próprio
job limpa somente a fixture sintética determinística e reconcilia uma falha ou
cancelamento. Um workflow `workflow_run` independente, serializado pelo mesmo
grupo de produção e protegido por novo lease `release:website`, com espera
limitada a 20 minutos para uma execução abandonada liberar o lease, repete a
reconciliação se o runner original desaparecer. Ele infere um candidato sem
checkpoint pós-deploy apenas quando a versão corrente é diferente da incumbente
e tanto o `x-app-build` quanto a tag de propriedade coincidem exatamente com o
release interrompido. Uma versão já restaurada ou substituída por outro release
é preservada. Depois que navegador e D1 passam, o smoke grava na descrição da
própria campanha sintética uma marca determinística contendo somente SHA e dono
da execução; a limpeza preserva essa marca enquanto desabilita a campanha e
revoga os quatro convites sintéticos. Assim, tanto a etapa no job original quanto
o reconciliador independente reconhecem uma jornada já validada mesmo se o
upload do artefato ou outra etapa posterior falhar, sem restaurar indevidamente
o site anterior. Nenhuma dessas rotinas apaga campanha real, convite, progresso,
shortlink ou D1, e “deletar e publicar do zero” não é um procedimento de
recuperação suportado.

O lease é obrigatório no recovery, inclusive em `workflow_run`; a variável de
ativação só pode fazê-lo falhar fechado, nunca transformar a reconciliação em
uma escrita sem coordenação. Produção também exige manifesto e tag de dono antes
do deploy e não possui fallback de rollback direto no helper. Se o marcador
durável não puder ser lido, o estado é indeterminado: a reconciliação falha e
preserva o Worker corrente até uma nova execução obter evidência, em vez de
interpretar indisponibilidade do D1 como autorização para rollback.
