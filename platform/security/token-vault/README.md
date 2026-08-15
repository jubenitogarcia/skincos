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
- `POST /internal/token-vault/v1/meta-ads-publish/config/bootstrap/rollback`
- `POST /internal/token-vault/v1/meta-ads-publish/config/staging-exercise`
- `POST /internal/token-vault/v1/analytics/operations`

Os endpoints administrativos exigem `Authorization: Bearer <TOKEN_VAULT_API_TOKEN>`.
O bearer restrito `TOKEN_VAULT_META_ADS_CONFIG_TOKEN` só pode consultar
`health`, `contract` e a configuração Meta Ads, ou chamar o bootstrap, o
rollback desse bootstrap e o exercício de staging. Ele não lista/altera tokens,
não cria runs e não publica anúncios.
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
- Secret privado do GitHub Environment, não um binding do Worker:
  `TOKEN_VAULT_META_ADS_BOOTSTRAP_MANIFEST` (somente as `entries` do bootstrap;
  exigido apenas quando a autoridade ainda é legada)
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
autentica primeiro a URL Preview imutável candidata; se
`config_authority_mode` for `legacy_bootstrap`, valida o envelope privado do
manifesto antes de qualquer ativação de tráfego e só então monta o corpo fechado
abaixo com a revisão opaca devolvida pelo GET e as `entries` do manifesto. Se já
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

Antes da primeira promoção, disponibilize em cada GitHub Environment os
segredos independentes exigidos pelo workflow, em especial
`TOKEN_VAULT_META_ADS_CONFIG_TOKEN` e, em staging,
`TOKEN_VAULT_N8N_API_TOKEN`; disponibilize
`TOKEN_VAULT_META_ADS_BOOTSTRAP_MANIFEST` somente com as fontes/tags autorizadas
quando a autoridade for legada, e um perfil de tracking sintético autorizado em
staging. A ausência de credencial, manifesto legada necessário, fixture,
bookmark ou evidência de staging é um bloqueio fail-closed para produção.

## Import inicial

Exporte a aba `Credencial` como CSV e importe pela API, para que o Worker criptografe antes de gravar no D1:

```bash
TOKEN_VAULT_API_TOKEN=... npm run seed:from-csv -- ./credentials.csv
```

O script não imprime tokens; ele reporta apenas provider, conta externa e tamanho mascarado.
