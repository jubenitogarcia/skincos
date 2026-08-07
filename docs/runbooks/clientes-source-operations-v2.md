# Clientes v2: operação contínua de fontes

Este runbook cobre somente a operação de fontes de Clientes v2 em local e
staging. Ele não autoriza promoção, escrita comercial, envio de mensagens,
remoção de registros ausentes nem execução contra produção. production não é
um alvo aceito pelo runner e deve falhar fechado.

O estado atual é **observação/dry-run**. O serviço crm-jobs.service fica
desabilitado no template e, mesmo quando instalado, inicia com jobs e apply
desligados. Um --apply sem todos os controles abaixo deve terminar em erro
sanitizado, sem modificar fonte ou destino.

O timer legado `crm-clientes-source-refresh.timer` está aposentado: os antigos
runner e instalador agora falham fechado antes de ler qualquer arquivo privado,
variável ou comando. Em um host que ainda tenha o timer instalado, use somente
o script nativo com gramática fixa `retire-clientes-source-refresh-service.sh
--dry-run` e, após a evidência da janela de mudança, `--apply`. Ele desabilita
apenas os dois nomes de unidade legados; não aceita path, ambiente, URL ou
comando fornecido externamente. A aposentadoria deve preceder a ativação de
`crm-jobs.service` para não haver dois schedulers de fonte.

## Catálogo estático

O catálogo é metadata-only: identificadores, cadência e capacidades ficam em
crm/api/server/clientes/sourceCatalog.js; URLs, IDs de planilha, credenciais e
conteúdo de fontes ficam exclusivamente no runtime privado.

| Fonte | Domínio / uso | Cadência | Obrigatória | Tipo de observação |
| --- | --- | ---: | :---: | --- |
| atendimento.local_mirror | Atendimento, identidade | 30 min | Sim | Snapshot PostgreSQL |
| atendimento.google_sheet | Atendimento, identidade | 30 min | Sim | Snapshot Google Sheets |
| cadastro.gerencia_google_sheet | Cadastro, identidade | 30 min | Sim | Snapshot Google Sheets |
| vendas.caixa_google_sheet | Vendas, identidade | 60 min | Sim | Snapshot Google Sheets |
| cadastro.app_registrations | Cadastro, identidade | 60 min | Sim | Conector externo |
| leads.supplemental_google_sheet | Enriquecimento de identidade | 60 min | Não | Conector externo |
| consent.harmonia_opt_outs | Consentimento, bloqueios | 5 min | Sim | Agregado PostgreSQL |
| blocks.commercial_permissions | Consentimento, bloqueios | 5 min | Sim | Agregado PostgreSQL |
| identity.global_graph | Identidade, elegibilidade comercial | 15 min | Sim | Agregado PostgreSQL |

O tick do job clientes.source_update é de 60 segundos somente para perceber
qual fonte venceu a própria cadência. Não substitui a cadência registrada no
catálogo nem dispara fontes não devidas.

## Limites de ambiente e identidade

O runner confere a identidade do banco antes de operar:

| Alvo | Banco aceito | Regra adicional |
| --- | --- | --- |
| local | skincos_crm_local | O usuário não pode ser postgres. |
| staging | skincos_staging | O usuário não pode ser postgres. |

DATABASE_URL é lida somente do arquivo de ambiente privado do runtime. Não a
coloque em comandos, logs, artefatos, GitHub Environments nem documentação.
O migrador local aceita exclusivamente o destino local; para staging, use o
migrador de staging já target-bound. O migrador de staging deve ser tratado
como um release de schema completo: seu --rollback não é o mecanismo de
rollback de uma única fonte.

As variáveis abaixo são nomes de contrato, nunca valores a copiar para o
repositório ou para a evidência:

| Nome | Finalidade | Regra |
| --- | --- | --- |
| CRM_CLIENTES_SOURCE_OPERATIONS_TARGET | Seleciona local ou staging. | Obrigatória; qualquer outro valor falha fechado. |
| CRM_CLIENTES_SOURCE_OPERATIONS_MODE | Modo contínuo dry-run ou apply. | Manter dry-run até todos os gates de apply estarem atendidos. |
| CRM_CLIENTES_SOURCE_OPERATIONS_APPLY_ENABLED | Primeiro gate de escrita de fonte. | Desligado por padrão. |
| CRM_CLIENTES_SOURCE_OPERATIONS_APPLY_CONFIRMED | Segunda confirmação independente. | Desligada por padrão; não basta sozinha. |
| CRM_CLIENTES_SOURCE_FINGERPRINT_KEY | Chave privada HMAC para fingerprints e hashes de cursor/escopo. | Deve existir no runtime privado e ter material suficiente; nunca exibir, registrar ou reutilizar como identificador. |
| ATENDIMENTO_ACTOR_HMAC_KEY | Assinatura do ator na visão HTTP operacional. | Chave privada existente; nunca registrar o valor. |
| ATENDIMENTO_SOURCE_DATABASE_URL | Origem do espelho de Atendimento. | Privada; não é aceita como comando ou caminho. |
| ATENDIMENTO_GOOGLE_SA_FILE | Credencial privada dos snapshots Google permitidos. | Caminho privado, fora do repositório e da saída operacional. |
| APP_REGISTRATION_SOURCE_CONNECTOR | Contrato do conector de cadastros do app. | Não habilita execução por string/comando de ambiente. |
| SUPPLEMENTAL_LEADS_SOURCE_CONNECTOR | Contrato do conector de leads suplementares. | Não habilita execução por string/comando de ambiente. |

Nenhuma variável é interpretada como shell, URL de comando, eval, SSH ou
programa a executar. Os adaptadores, fontes e bridges são allowlisted no
release. O launcher do worker só aceita disabled ou observe; assisted é
recusado por design.

## Contrato de integridade

Cada fonte é executada sob lock advisory PostgreSQL por fonte, cobrindo a
sequência leitura → backup → aplicação. O lock impede duas leituras/aplicações
concorrentes e não mantém transação aberta durante I/O de rede. Se estiver
ocupado, a execução é marcada como skipped com motivo sanitizado.

O ledger usa a chave única (source_id, execution_key, mode). Repetir a mesma
execução terminal é idempotente. Uma fonte não pode aceitar snapshot com
watermark anterior ao checkpoint validado, salvo se for o mesmo fingerprint
completo; nesse caso é apenas skipped, nunca reaplicado.

Um snapshot é complete somente quando contém prova tipada de completude:

- tipo permitido (aggregate_count, partition_count, postgres_relation ou
  sheet_snapshot);
- contagens esperadas e observadas de registros e partições iguais;
- scopeHash HMAC válido;
- watermark e fingerprint válidos;
- a contagem observada igual à contagem lida.

Sem essa prova, o estado é incomplete/invalid, o checkpoint de retomada não
avança e a ausência nunca é tratada como exclusão residual. Mesmo em apply, o
adapter recebe allowRetireMissing: false; exclusão ou aposentadoria automática
por ausência é proibida.

Os checkpoints separam evidência **validada** de **aplicada**. Uma leitura
completa de dry-run pode atualizar a evidência validada, mas não a evidência de
aplicação. Falhas, snapshots parciais e snapshots antigos preservam o último
checkpoint válido. Cursores externos nunca são persistidos: somente watermark
e hash opaco de cursor.

Falhas retryable usam backoff de 30 s, 60 s, 120 s, 240 s, 480 s e no máximo
15 min. Falhas permanentes geram estado dead e dead-letter append-only. Uma
falha durante applying exige reconciliação explícita pelo adapter antes de
novo término; ela não é convertida silenciosamente em sucesso.

## Backup, apply e rollback de fonte

--apply só é elegível depois de um dry-run saudável do mesmo release e somente
se todos estes controles forem verdadeiros:

1. alvo e identidade de banco válidos;
2. flags CRM_CLIENTES_SOURCE_OPERATIONS_APPLY_ENABLED e
   CRM_CLIENTES_SOURCE_OPERATIONS_APPLY_CONFIRMED ativadas no ambiente privado
   aprovado;
3. snapshot completo, atual e diferente do último aplicado;
4. bridge revisada no release para aquela fonte, com backup, apply e rollback
   tipados;
5. backup criado antes da aplicação, com referência opaca, manifesto sha256,
   criptografia e restauração declaradas;
6. prova de restore do backup em scratch e evidência privada conforme a
   [política de backup e restauração](backup-and-restore-policy.md);
7. lock adquirido e nenhuma reconciliação pendente.

O CLI e o worker não aceitam comando, caminho de backup ou conector arbitrário
via variáveis. Na implementação atual, createClientesSourceAdapters não injeta
uma bridge de aplicação no entrypoint operacional; portanto, mesmo com as duas
flags, o apply deve permanecer bloqueado por SOURCE_APPLY_DISABLED até que uma
bridge específica seja implementada, revisada e validada. Isso é intencional:
o fluxo v2 não abre escrita por configuração.

Para reverter uma aplicação já autorizada:

1. interrompa o agendamento da fonte/processo de jobs de forma controlada e
   confirme que não há lock em andamento;
2. localize a referência opaca do backup no ledger privado, sem expor caminho,
   conteúdo ou segredo;
3. execute somente o rollback allowlisted para uma fonte do catálogo;
4. confirme o evento append-only de rollback e reconciliationRequired=true;
5. faça um novo dry-run e uma reconciliação validada antes de considerar a
   fonte saudável novamente.

O rollback de fonte restaura somente por bridge revisada e registra a operação;
ele não exclui evidências, backups, eventos ou dead letters. Já o rollback da
migration v2 é não destrutivo: apenas marca a migration como revertida e
preserva schema/evidências. Não use nenhum rollback como mecanismo para apagar
dados.

## CLI nativa allowlisted

Execute apenas no release imutável provisionado, com ambiente privado já
carregado pelo runtime. A gramática do entrypoint é deliberadamente pequena:

~~~text
npm --prefix crm/api run clientes-source-operations -- --status
npm --prefix crm/api run clientes-source-operations -- --dry-run
npm --prefix crm/api run clientes-source-operations -- --apply
npm --prefix crm/api run clientes-source-operations -- --rollback \
  --source=<id-exato-do-catalogo> --backup=<referencia-opaca-do-ledger>
~~~

Não acrescente parâmetros, paths, URLs, --command, argumentos de shell ou mais
de uma ação. O parser rejeita qualquer fonte fora do catálogo e qualquer
referência de backup que pareça caminho inseguro. O resultado permitido contém
somente alvo, banco, fonte, status, freshness, timestamps, contagens,
divergências, snapshotComplete, código de erro e retries. Não contém linhas de
origem, PII, mensagens de erro, credenciais, cursors, payloads ou referências
de backup.

Antes de operar, valide schema e grants pelo caminho correto do alvo:

~~~text
# local, no runtime local privado
npm --prefix crm/api run migrate-clientes-source-operations -- --dry-run

# staging, no runtime staging privado e com migrator dedicado
npm --prefix crm/api run migrate-atendimento-staging -- --dry-run
~~~

O apply da migration segue apenas após o dry-run, backup/evidência do alvo e o
procedimento de mudança aplicável. Não inclua DATABASE_URL ou valores de HMAC
na linha de comando.

## Visão operacional, métricas e alertas

A visão agregada é fornecida por GET /commercial/source-operations. Ela é
somente leitura, requer gestor comercial global e recusa explicitamente gestor
com escopo de unidade declarado, porque as contagens ainda são globais. A rota
retorna 503 sanitizado quando schema, pool ou dependência não estão prontos.

Para cada fonte, acompanhe:

| Grupo | Campos seguros |
| --- | --- |
| Estado | status, freshness, snapshotComplete, reconciliationRequired, obrigatoriedade e usos declarados |
| Tempo | última execução, última leitura, último sucesso, último apply, próxima execução, duração |
| Volume | registros lidos, aplicados, divergências e retries |
| Falha | contagem de erros e apenas código allowlisted/retryable |

O ledger e a visão nunca levam PII. Fingerprints, hashes de escopo e cursor são
opacos; métricas e logs não recebem linhas, nomes, telefone, e-mail, IDs de
planilha, URLs, tokens, mensagens de provider ou erro bruto.

Freshness é avaliada pela última observação validada e saudável:

| Janela | Estado | Ação |
| --- | --- | --- |
| Menos de 20 h | healthy | Seguir a cadência. |
| A partir de 20 h e até 48 h | preventive | Abrir alerta preventivo antes de 24 h, investigar configuração, lock e última execução. |
| Acima de 48 h, ausente, inválida, dead ou em reconciliação | high/missing | Finding alto imediato; manter fonte inelegível até observação saudável. |

Depois de cada execução, o runner atualiza o finding
source.freshness.<source-id> na fila de qualidade. Um finding resolvido ou
suprimido reabre automaticamente se a fonte voltar a ficar stale; só é fechado
quando a observação atual volta a healthy. O mecanismo entregue é a fila de
qualidade e sua visão operacional; integração com pager, e-mail ou webhook
externo continua pendente e não deve ser simulada com PII.

## Sequência de ativação local/staging

1. Use um SHA imutável e confirme que o serviço HTTP não inicia o worker.
2. Faça o dry-run de migration do alvo e confirme relações v2, grants mínimos
   do runtime e gatilhos append-only.
3. Configure somente no runtime privado os **nomes** de variáveis listados
   acima; confirme que nenhuma delas aparece em saída, GitHub Environment,
   arquivo versionado ou evidência.
4. Mantenha CRM_CONTINUOUS_WORKERS_ENABLED e
   CRM_CONTINUOUS_JOBS_ENABLED desligados até o smoke local. Quando ambos
   forem autorizados, mantenha o modo de fonte em dry-run.
5. Faça --status e --dry-run; registre apenas o JSON sanitizado e as contagens
   agregadas. Confirme que fontes obrigatórias estão completas, atuais e sem
   reconciliationRequired.
6. Teste repetição idempotente, contenção de lock, falha intermediária,
   retomada, snapshot incompleto, dead-letter e rollback em identidade
   sintética/local. Não use cliente, telefone ou evento comercial reais.
7. Em staging isolado, repita o mesmo release e checks; não habilite apply nem
   escrita comercial. Produção permanece fora desta tranche.

## Gates pendentes para maturidade de apply

Não habilitar apply até que todos os itens aplicáveis estejam evidenciados:

- migration v2, relações de qualidade prévias, triggers append-only e grants
  mínimos presentes no alvo;
- chave de fingerprint HMAC no runtime privado, sem vazamento em logs;
- bridge por fonte revisada, sem comando/path de ambiente, com backup cifrado,
  manifesto e rollback realmente testado em scratch;
- watermark estável para cadastro.gerencia_google_sheet (hoje uma leitura sem
  watermark upstream deve permanecer incomplete);
- conector permitido e prova de completude para cadastro.app_registrations
  (hoje deve permanecer unavailable até existir conector) e, quando desejado,
  para leads.supplemental_google_sheet;
- fontes obrigatórias completas e frescas; qualquer uma delas incompleta,
  indisponível, stale, dead ou em reconciliação impede readiness do conjunto;
- smoke de --dry-run, apply sintético, repetição, falha, retomada, concorrência,
  snapshot incompleto e rollback, com evidência sanitizada;
- integração externa de alertas, se for necessária além da fila de qualidade;
- autorização operacional explícita para uma futura escrita de fonte. Nenhum
  desses gates autoriza escrita comercial, consentimento, contato ou mensagem.

## Evidência mínima

Para cada janela local ou staging, guardar no runtime privado: SHA do release,
alvo, identificador de migration, horário UTC, resultado sanitizado de
--status/--dry-run, estado de cada fonte, confirmação de backup/restore quando
houver apply, e resultado dos testes de lock/retomada/rollback. Nunca anexar
comandos com secrets, dumps, payloads, PII, credenciais ou valores HMAC.
