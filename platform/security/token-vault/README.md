# Token Vault Worker

Worker interno para substituir a aba `Credencial` do Google Sheets usada pelo workflow n8n `Token Manager`.

## Endpoints

- `GET /internal/token-vault/health`
- `GET /internal/token-vault/contract`
- `GET /internal/token-vault/v1/tokens?provider=threads|instagram|facebook&active=true`
- `POST /internal/token-vault/v1/tokens`
- `PATCH /internal/token-vault/v1/tokens/:id`
- `GET /internal/token-vault/v1/meta-ads-publish/config`
- `PUT /internal/token-vault/v1/meta-ads-publish/config`
- `POST /internal/token-vault/v1/meta-ads-publish/config/bootstrap`
- `POST /internal/token-vault/v1/meta-ads-publish/config/bootstrap/derive-plan`
- `POST /internal/token-vault/v1/meta-ads-publish/config/bootstrap/derive`
- `POST /internal/token-vault/v1/meta-ads-publish/config/bootstrap/rollback`
- `POST /internal/token-vault/v1/meta-ads-publish/config/staging-synthetic-seed/attest`
- `POST /internal/token-vault/v1/meta-ads-publish/config/staging-synthetic-seed/attest-appsecret-proof`
- `POST /internal/token-vault/v1/meta-ads-publish/config/staging-synthetic-seed`
- `POST /internal/token-vault/v1/meta-ads-publish/config/staging-synthetic-seed/rollback`
- `POST /internal/token-vault/v1/meta-ads-publish/config/staging-exercise`
- `POST /internal/token-vault/v1/analytics/operations`

Os endpoints administrativos exigem `Authorization: Bearer <TOKEN_VAULT_API_TOKEN>`.
O bearer restrito `TOKEN_VAULT_META_ADS_CONFIG_TOKEN` só pode consultar
`health`, `contract` e a configuração Meta Ads, ou chamar o planejamento e
bootstrap governados, o rollback desse bootstrap e o exercício de staging. Ele
não lista/altera tokens, não cria runs e não publica anúncios.
O bearer efêmero distinto `TOKEN_VAULT_META_ADS_STAGING_SEED_TOKEN` só alcança
os quatro endpoints de atestação, prova de `appsecret_proof`, seed e rollback sintéticos, exclusivamente no
Worker staging; ele não ganha as permissões do bearer de configuração,
operacional ou administrativo.
O endpoint de analytics exige o secret separado
`TOKEN_VAULT_ANALYTICS_API_TOKEN` (administradores continuam podendo operar o
endpoint para diagnóstico controlado).

## Bindings e secrets

- D1 binding: `TOKEN_VAULT_DB`
- Secret: `TOKEN_VAULT_API_TOKEN`
- Secret: `TOKEN_VAULT_N8N_API_TOKEN` (gateway operacional do Orb)
- Secret: `TOKEN_VAULT_ANALYTICS_API_TOKEN` (somente analytics read-only)
- Secret: `TOKEN_VAULT_ENCRYPTION_KEY`
- Secret opcional do Worker: `TOKEN_VAULT_META_ADS_CONFIG_TOKEN` (papel
  restrito de configuração Meta Ads; obrigatório no Environment quando há
  promoção V20 governada)
- Secret efêmero opcional do Worker: `TOKEN_VAULT_META_ADS_STAGING_SEED_TOKEN`
  (capacidade exclusiva dos endpoints de seed/rollback sintéticos; o workflow
  gera-o em `RUNNER_TEMP` somente para a versão candidata de staging, e nunca
  o persiste como secret do GitHub)
- Secret privado opcional do GitHub Environment, não um binding do Worker:
  `TOKEN_VAULT_META_ADS_BOOTSTRAP_MANIFEST` (override explícito das `entries`
  do bootstrap legado; nunca é recebido quando o plano interno é derivável)
- Variável opcional: `META_GRAPH_VERSION` (default `v20.0`)
- Variável de gate: `INFLUENCER_INTELLIGENCE_ANALYTICS_MODE` (`off` por
  padrão; `shadow` permite requests bounded; `active` exige também a flag
  explícita `INFLUENCER_INTELLIGENCE_ENABLED=true`)

Os tokens são gravados em D1 como AES-GCM ciphertext. Logs, auditoria e respostas de PATCH não retornam token em claro.

## Configuração governada do Meta Ads Publish

`PUT /internal/token-vault/v1/meta-ads-publish/config` continua sendo o writer
administrativo para uma configuração V20 já conhecida. Ele aceita somente
`operation_key`, `expected_tracking_binding_revision` e `updates`, preserva os
outros campos de `metadata_json` e substitui `metadata.meta_ads_publish` em um
batch D1 condicionado às versões lidas. `POST`/`PATCH /v1/tokens` rejeitam essa
metadata, pois um merge raso não é seguro.

Para converter a autoridade legada, use somente o bootstrap restrito. O deploy
autentica primeiro a URL Preview imutável candidata. Se
`config_authority_mode` for `legacy_bootstrap`, ele prefere
`POST .../bootstrap/derive-plan`: o Vault faz apenas Graph GETs sobre os
destinos já configurados, aceita fonte e tags somente quando há seletor privado
explícito ou peer distinto na mesma linhagem única/compatível (nunca adota a
creative do próprio target como fonte), e devolve exclusivamente a revisão
opaca, hash do plano completo e contagens agregadas. O hash cobre os fatos
Graph que influenciam perfil e reconciliação. Após o candidato receber tráfego,
`POST .../bootstrap/derive` refaz essa leitura e só invoca a saga journalizada
se o hash e a revisão ainda coincidirem. IDs, tags e entries nunca atravessam o
Worker.

`TOKEN_VAULT_META_ADS_BOOTSTRAP_MANIFEST` continua como override protegido para
uma fonte já autorizada que não seja derivável; nesse caso o deploy valida e
hash-vincula seu envelope antes do tráfego. Se a derivação for ambígua,
incompatível, indisponível ou mudar entre as duas fases, o rollout falha fechado
sem ativar tráfego novo ou escolher uma campanha por inventário de conta. Se já
for `tracking_ready`, ele apenas faz o readback e não solicita nem recebe o
manifesto.

    {
      "operation_key": "meta-ads-bootstrap:<sha>:<run>:<attempt>",
      "expected_config_authority_revision": "legacy:<hash>",
      "entries": [
        {
          "config_token_id": "...",
          "destination_type": "website",
          "source_config_token_id": "...",
          "url_tags": "key1=value1&key2=value2"
        },
        {
          "config_token_id": "...",
          "destination_type": "whatsapp"
        }
      ]
    }

Cada Website usa uma fonte autorizada já existente (`source_config_token_id` ou
`source_adset_id`, nunca ambos). O Vault resolve internamente credenciais e
IDs, lê pixel/evento Website e dataset offline da fonte e cria ou reutiliza a
fixture de criativo pausado. `url_tags` aceita pares arbitrários `key=value`
separados por `&`, preserva UTMs quando fornecidas e não aplica double encoding.
Click-to-WhatsApp não recebe `url_tags`, perfil Website nem configuração de
conversão Website.

No manifesto de staging, exatamente uma entry Website marca
`staging_synthetic_fixture: true`; `fixture_source_ad_id` é opcional e serve
somente para fixar uma cópia pausada já autorizada. A seleção nunca aceita um
token Graph, pixel, evento ou dataset fornecido pelo chamador.

O bootstrap exige que todas as credenciais Facebook já participantes sejam
incluídas, mantém journal D1 com estado Graph cifrado e responde apenas com
estado/revisão agregados. É idempotente por `operation_key`; não aceita tokens,
access tokens, secrets, ciphertexts nem IDs de pixel/evento/dataset no
manifesto. Não inclua manifestos, headers `Authorization` ou respostas
detalhadas em Git, comentários de PR ou logs.

`POST .../config/bootstrap/rollback` não é um rollback genérico: exige a mesma
`operation_key` aplicada e a revisão V20 exata. Ele restaura primeiro o baseline
Graph cifrado e só então a metadata legada; conflito ou readback ambíguo ficam
em fail-closed (`reconciliation_required`).

`POST .../config/staging-exercise` funciona exclusivamente no Worker staging.
Ele seleciona uma única fixture sintética autorizada, prova a reconciliação
GET-POST-GET do evento Website/dataset offline e restaura o snapshot antes de
retornar `reconciled_and_rolled_back`.

Quando a autoridade legada de staging está vazia, o caminho canônico não
adivinha nem importa configuração de produção. Antes de derivar o plano, o
workflow chama `POST .../config/staging-synthetic-seed/attest` na Preview
imutável com um bearer aleatório exclusivo da versão candidata. A atestação faz
somente leituras Graph delimitadas, não toca D1 nem cria recursos, e retorna
apenas `match` ou um código sanitizado que distingue rejeição da credencial de
fonte, acesso ao Pixel, Página ou dataset, e indisponibilidade transitória. Só
então o workflow chama
`POST .../config/staging-synthetic-seed`. Os fatos externos entram somente no
corpo dessas chamadas privadas: o token Meta Ads já custodiado,
`META_PIXEL_ID`, `META_ADS_ACCOUNT_ID`, `META_ADS_API_VERSION` e os segredos
privados do GitHub Environment `staging` `novohamburgo_page_id` e
`barrashopppingsul_page_id`. Os dois últimos são seletores factuais de
identidade, nunca bearers, e seus valores não aparecem em logs, outputs,
artefatos ou PRs. O fluxo associa o primeiro exclusivamente à unidade Novo
Hamburgo e o segundo exclusivamente à unidade Barra Shopping Sul; para cada
unidade, prova pela relação limitada de Páginas atribuídas ao System User uma
única associação elegível e confirma o mesmo par Página+Instagram por leitura
direta. Os pares devem ser distintos. Os seletores não são bindings do Worker
e não entram no `--secrets-file`, artefato, log ou output do workflow. O Vault
exige então uma conta/pixel, os dois pares Página+Instagram provados e um
dataset offline unívoco, cria somente recursos `PAUSED` nomeados para staging e
sela duas credenciais internas cifradas. Não seleciona campanhas, conjuntos ou
anúncios comerciais, nem torna o token Meta um binding do Worker.

O workflow manual separado de prova candidata cria somente uma versão imutável
não promovida e chama `POST .../staging-synthetic-seed/attest-appsecret-proof`.
Esse endpoint exige que a própria versão candidata tenha gerado
`appsecret_proof` a partir do binding herdado; ele repete as leituras Graph
delimitadas, não toca D1 nem tráfego, e devolve apenas
`appsecret_proof_verified` ou um código sanitizado. Ele não cria, copia nem
revela `META_APP_SECRET`.

O endpoint responde apenas `sealed` ou `not_required` e uma identidade opaca
de operação. Se qualquer passo subsequente falhar antes do tráfego, ou se a
compensação de staging for acionada, `POST .../staging-synthetic-seed/rollback`
usa a mesma capacidade efêmera para arquivar exclusivamente os objetos de
entrega marcados e desativar as credenciais seladas. Um `AdCreative` já
desanexado não possui estado de arquivamento documentado: ele fica inerte,
identificado somente no journal cifrado, sem ad ativo, conjunto ativo ou
credencial ativa. Estados ambíguos falham fechados; o workflow nunca repete uma
criação Graph incerta nem usa `wrangler secret put`.

## Analytics read-only

`POST /internal/token-vault/v1/analytics/operations` aceita somente o contrato
versionado do Influencer Intelligence. O chamador envia `provider=meta-graph`,
uma operação fechada e um `credential_ref` opaco. O Worker só usa uma
credencial `instagram` ativa com `metadata.analytics_scopes` contendo
`influencer-intelligence`; o token é descriptografado apenas dentro do Worker
e usado em chamadas `GET` fixas ao Meta Graph. Nenhum token, sessão, URL de
credencial, payload bruto, comentário ou ação de escrita atravessa a resposta.

Gaps de permissão/cobertura retornam um envelope `unavailable`; timeouts,
limites, falhas transitórias e respostas inválidas retornam erros estruturados
para o retry/circuit breaker do router. Falha de auditoria encerra a operação
sem resposta de sucesso. O endpoint não substitui o gateway de publicação e
não deve ser usado para follow, like, DM, post, upload ou scraping.

O caminho deve ser configurado primeiro em staging com o secret dedicado. Não
ativar a flag/grant de Influencer Intelligence, importar o workflow Orb ou
aplicar as migrations PostgreSQL como parte da configuração do Worker.

O `health` só fica `ok=true` quando D1, as chaves de administração e
operacional, a chave de analytics e a chave de criptografia estão presentes.
A ausência de qualquer uma mantém o Worker unhealthy e impede que um deploy
parcial pareça pronto para o transport real.

O modo `off` rejeita o caminho analytics com `analytics_disabled` antes de
descriptografar credenciais ou chamar o Meta Graph. `shadow` é o único modo
esperado para o primeiro smoke controlado; ele não habilita CRM, MCP, Orb ou
unidades systemd. `active` permanece bloqueado até a flag server-side também
estar explicitamente verdadeira.

## Gate operacional de analytics em staging

O secret `TOKEN_VAULT_ANALYTICS_API_TOKEN` deve existir separadamente no
Worker de staging e no arquivo privado do serviço interno. O valor deve ser
provisionado pela custódia aprovada no GitHub Environment `staging`; o workflow
canônico somente confere o nome do secret e nunca recebe, imprime ou grava seu
valor. Não execute `wrangler secret put`, `wrangler versions deploy` ou outra
mutação manual para contornar esse gate.

Antes do dispatch, registre a versão incumbent e o rollback, disponibilize uma
credencial de staging explicitamente aprovada e confirme uma fixture sintética
isolada, marcada no perfil autorizado como `staging_synthetic_fixture=true`.
O publicador exige que fonte e alvo sejam distintos e, em cada promoção de
staging, executa `ensure_adset_conversion_contract` (`GET` -> `POST` -> `GET`)
e o rollback explícito (`GET` -> `POST` -> `GET`) nessa fixture; nenhuma ID
crua sai da evidência. Um smoke Meta read-only exige
`provider=instagram` e `metadata.analytics_scopes=["influencer-intelligence"]`;
sem essa fixture o resultado esperado é `unavailable`, não uma coleta implícita.
A flag/grant do módulo, os units internos e o workflow Orb permanecem desligados
durante este gate.

### Bootstrap selado da primeira credencial Meta

Quando o D1 de staging ainda não contém credencial `instagram`, o workflow
manual `Influencer Intelligence Staging Shadow` pode selar exatamente uma
credencial dedicada no Vault. O operador configura os valores de credencial
somente como **environment secrets** do ambiente GitHub `staging`, nunca em
chat, URL, terminal, commit, artefato ou variável de repositório:

- `INFLUENCER_INTELLIGENCE_META_GRAPH_TOKEN`: token long-lived de Login do
  Facebook/Business Login, dedicado ao gate. Não reutilizar `META_ACCESS_TOKEN`
  de CAPI.
- `INFLUENCER_INTELLIGENCE_META_GRAPH_INSTAGRAM_ACCOUNT_ID`: identificador
  numérico da conta Instagram profissional conectada à Página que autorizou o
  token.

O creator alvo não é um segredo. O operador o informa como input não secreto
`shadow_creator_handle` no dispatch manual, exclusivamente quando
`run_real_router_smoke=true`. O workflow aceita somente uma jornada para esse
`@handle` aprovado, falha fechada quando ele estiver ausente e não o inclui nas
evidências redigidas ou nos logs do job.

Para este smoke, o token deve ser de um operador que tem acesso à Página e à
conta profissional conectada, com os escopos de leitura aprovados no app (em
particular `instagram_basic`, `instagram_manage_insights` e
`pages_read_engagement`). `pages_show_list` só é necessário para descobrir a
conta raiz; se a função do usuário na Página foi concedida pelo Gerenciador de
Negócios, acrescentar `ads_read` ou `ads_management`. Não conceder escopos de
publicação, mensagens, follow, like ou comentários para esse gate.

O endpoint interno de bootstrap não aparece no contrato normal e só aceita
`POST /internal/token-vault/v1/analytics/staging-bootstrap` autenticado por um
segredo efêmero distinto, criado pelo job. Ele funciona somente quando
`ENVIRONMENT=staging`, modo analytics `shadow` e
`INFLUENCER_INTELLIGENCE_ENABLED=false`. Aceita um schema fechado com token,
referência opaca e ID profissional; não chama Meta, não expõe nenhum desses
valores, não atualiza/revoga credenciais e grava a credencial AES-GCM e a
auditoria no mesmo batch D1. Se qualquer credencial Instagram já existir, o
endpoint retorna `bootstrap_already_sealed` ou
`bootstrap_existing_credential`; não há overwrite ou fallback.

O segredo efêmero continua sem capacidade de leitura ou escrita depois do
primeiro selo: ele só enxerga esse endpoint e o endpoint passa a recusar todas
as chamadas quando existe uma credencial Instagram. Ele também torna a
configuração inválida fora de `staging` + `shadow` com o módulo desabilitado,
exigindo remoção/rotação explícita antes de qualquer promoção futura. A única chamada Graph do gate é
feita depois pelo router Meta-only, com timeout de 12 s e retry seguro limitado.

## Governed deploy

Use `.github/workflows/deploy-token-vault.yml` for every staging or production
promotion. It creates an immutable Worker candidate, preserves inherited
production bindings, and activates only after its environment-specific gates
and rollback evidence pass.

Staging has no Orb consumer for the Token Vault operational bearer. Its
`TOKEN_VAULT_N8N_API_TOKEN` is therefore an independent, high-entropy protected
GitHub Environment secret. The canonical workflow writes it only to the
candidate `--secrets-file` with private permissions and never prints it or uses
`wrangler secret put`. Production retains its already-attested Orb/Worker
binding; it is not copied into staging.

The restricted `TOKEN_VAULT_META_ADS_CONFIG_TOKEN` must be an opaque printable
ASCII bearer without a UTF-8 BOM or control characters. The release gate checks
that representation before it acquires a lease, migrates D1, or changes Worker
traffic. Every immutable candidate must then authenticate with that bearer at
its version preview URL before it can receive traffic. After an activation, the
workflow waits for the canonical route to accept that bearer before it runs
bootstrap or the reversible fixture exercise; the preview proves candidate
authentication, while the canonical-route check proves data-plane auth
readiness.

O Token Vault é publicado exclusivamente por
`.github/workflows/deploy-token-vault.yml`: Preview -> Staging -> Production.
O workflow exige o gate imutável de promoção, lease global
`release:token-vault`, bookmark D1 Time Travel antes das migrations aditivas,
upload de versão imutável e readback sanitizado. O bookmark registra somente a
recuperação manual: restaurar D1 exige um novo lease `release:token-vault`,
confirmação do incumbent e ausência de writers conflitantes; não há restore
automático do banco.

O upload preserva bindings incumbentes com `--keep-vars --strict`; só fornece o
bearer restrito do Environment e, se o binding analytics ainda não existir,
pode gerar seu valor privado para a versão candidata. Preview só emite evidência
depois do teste e dry-run. Em staging e produção, após ativar o Worker candidato,
o workflow faz bootstrap apenas para autoridade legada, valida o readback V20 e
em staging executa a fixture reversível. Em produção, ele exige a source release
nativa exata, aplica o Orb inativo com versão esperada e termina com o preflight
Orb. Não execute `wrangler deploy`, `secret put` ou migrations remotas
manualmente para publicar este serviço.

Para o primeiro bootstrap Meta Ads de staging, o mesmo upload gera
`TOKEN_VAULT_META_ADS_STAGING_SEED_TOKEN` com CSPRNG em um arquivo `0600` sob
`RUNNER_TEMP`, inclui-o somente no `--secrets-file` privado da candidata e
remove esse arquivo no encerramento do job. A atestação e a seed Preview leem o
bearer por arquivo e entregam os fatos Meta somente em memória aos seus corpos
fechados; os valores não entram em `GITHUB_OUTPUT`, artefatos, logs, worktree
ou argv. A atestação é estritamente somente leitura; a seed é estritamente
`staging`, ocorre antes da autenticação/derivação de configuração e possui
rollback explícito antes de qualquer ativação quando o planejamento falha.
`META_ADS_ACCESS_TOKEN` continua uma credencial externa de fonte: não é copiado
de production nem inventado pelo fluxo. Os seletores privados
`novohamburgo_page_id` e `barrashopppingsul_page_id` devem ser escolhidos na
fonte Meta autorizada e gravados somente no GitHub Environment `staging`, cada
um para sua própria unidade e respectivo par Página+Instagram. No deploy
governado de staging, os dois seletores são exigidos, devem ser numéricos e
distintos; ausência, formato inválido, relação não atribuída ou par
Página/Instagram divergente interrompem o preflight antes de migrations, D1,
seed ou tráfego. Essa garantia é do preflight governado: uma chamada direta à
API candidata não é substituta dele e não deve ser usada para inferir que uma
falha de seletor ocorrerá antes de qualquer journal interno. A API candidata
aceita somente o mapa completo `destination_page_ids` para as duas unidades.

Antes da primeira promoção, disponibilize em cada GitHub Environment os
segredos independentes exigidos pelo workflow, em especial
`TOKEN_VAULT_META_ADS_CONFIG_TOKEN` e, em staging,
`TOKEN_VAULT_N8N_API_TOKEN`. Para uma autoridade legada, o Vault primeiro tenta
derivar internamente um plano único e hash-vinculado; disponibilize
`TOKEN_VAULT_META_ADS_BOOTSTRAP_MANIFEST` somente como override protegido quando
essa prova não for derivável. A ausência de credencial, uma derivação/override
factualmente inválida, fixture, bookmark ou evidência de staging é um bloqueio
fail-closed para produção.

## Import inicial

Exporte a aba `Credencial` como CSV e importe pela API, para que o Worker criptografe antes de gravar no D1:

```bash
TOKEN_VAULT_API_TOKEN=... npm run seed:from-csv -- ./credentials.csv
```

O script não imprime tokens; ele reporta apenas provider, conta externa e tamanho mascarado.
