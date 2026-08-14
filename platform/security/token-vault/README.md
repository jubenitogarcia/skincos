# Token Vault Worker

Worker interno para substituir a aba `Credencial` do Google Sheets usada pelo workflow n8n `Token Manager`.

## Endpoints

- `GET /internal/token-vault/health`
- `GET /internal/token-vault/contract`
- `GET /internal/token-vault/v1/tokens?provider=threads|instagram|facebook&active=true`
- `POST /internal/token-vault/v1/tokens`
- `PATCH /internal/token-vault/v1/tokens/:id`
- `PUT /internal/token-vault/v1/meta-ads-publish/config`
- `POST /internal/token-vault/v1/analytics/operations`

Os endpoints administrativos exigem `Authorization: Bearer <TOKEN_VAULT_API_TOKEN>`.
O endpoint de analytics exige o secret separado
`TOKEN_VAULT_ANALYTICS_API_TOKEN` (administradores continuam podendo operar o
endpoint para diagnóstico controlado).

## Bindings e secrets

- D1 binding: `TOKEN_VAULT_DB`
- Secret: `TOKEN_VAULT_API_TOKEN`
- Secret: `TOKEN_VAULT_N8N_API_TOKEN` (gateway operacional do Orb)
- Secret: `TOKEN_VAULT_ANALYTICS_API_TOKEN` (somente analytics read-only)
- Secret: `TOKEN_VAULT_ENCRYPTION_KEY`
- Variável opcional: `META_GRAPH_VERSION` (default `v20.0`)
- Variável de gate: `INFLUENCER_INTELLIGENCE_ANALYTICS_MODE` (`off` por
  padrão; `shadow` permite requests bounded; `active` exige também a flag
  explícita `INFLUENCER_INTELLIGENCE_ENABLED=true`)

Os tokens são gravados em D1 como AES-GCM ciphertext. Logs, auditoria e respostas de PATCH não retornam token em claro.

## Configuração governada do Meta Ads Publish

O endpoint PUT /internal/token-vault/v1/meta-ads-publish/config é o único
writer para metadata.meta_ads_publish. Ele exige o bearer administrativo,
aceita somente um corpo fechado com operation_key,
expected_tracking_binding_revision e updates; cada item de updates contém
somente token_id e meta_ads_publish. Nenhum campo de token, access token,
secret, ciphertext ou metadata externo é aceito.

O writer recebe todos os destinos que precisam mudar no mesmo lote. Ele
preserva os outros campos de metadata_json de cada credencial e substitui
somente metadata.meta_ads_publish com uma única operação D1 condicionada a
todas as versões anteriores. Operação, atualizações e auditoria sanitizada são
atômicas. POST/PATCH /v1/tokens rejeitam qualquer metadata.meta_ads_publish,
pois o merge raso desses endpoints não é seguro para essa configuração.

O operador primeiro consulta GET /v1/meta-ads-publish/config com a credencial
administrativa e usa exatamente config_authority_revision como
expected_tracking_binding_revision. Quando a fonte ainda é legada, esse valor
tem o formato legacy:<hash> e é derivado da configuração atual; não existe
valor curinga ou bypass. Após a substituição, a resposta do writer retorna
somente hashes, status e requestId; uma repetição com o mesmo operation_key e
o mesmo corpo é idempotente.

O manifesto deve ficar em custódia privada, fora do repositório, logs e
histórico de shell. A forma do corpo é:

    {
      "operation_key": "...",
      "expected_tracking_binding_revision": "...",
      "updates": [
        {
          "token_id": "...",
          "meta_ads_publish": {
            "destination_group": "...",
            "api_version": "...",
            "account_id": "...",
            "campaign_id": "...",
            "adset_id": "...",
            "page_id": "...",
            "instagram_user_id": "...",
            "allowed_link_hosts": ["..."],
            "landing_pages_by_creative_group": {},
            "destination_type": "website",
            "tracking_contract": {
              "url_tags": "...",
              "profile_ref": "...",
              "production_url_tags_readback_fixture": {
                "ad_id": "...",
                "creative_id": "..."
              }
            },
            "tracking_profiles": {}
          }
        }
      ]
    }

Para destination_type="website", o contrato exige parâmetros url_tags válidos
(pares arbitrários key=value separados por &, preservados sem double encoding),
um perfil Website com requisitos explícitos para evento de website e dataset
offline, e uma fixture de criativo pausado. IDs de pixel, evento e dataset não
são aceitos no manifesto: o Gateway os lê do ad set fonte autorizado. Para
destination_type="whatsapp", use whatsapp_destination_url HTTPS de WhatsApp e
omita integralmente tracking_contract, tracking_profiles e campos de carousel.

Fluxo seguro: obter a revisão opaca via GET, preparar o manifesto privado,
enviar o PUT com bearer injetado pela custódia sem imprimir o valor, repetir
GET /v1/meta-ads-publish/config para readback e só então executar o preflight
Meta Ads Publish. Não inclua manifestos privados, headers Authorization ou
respostas detalhadas em Git, comentários de PR ou logs.

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
credencial dedicada no Vault. O operador configura os valores somente como
**environment secrets** do ambiente GitHub `staging`, nunca em chat, URL,
terminal, commit, artefato ou variável de repositório:

- `INFLUENCER_INTELLIGENCE_META_GRAPH_TOKEN`: token long-lived de Login do
  Facebook/Business Login, dedicado ao gate. Não reutilizar `META_ACCESS_TOKEN`
  de CAPI.
- `INFLUENCER_INTELLIGENCE_META_GRAPH_INSTAGRAM_ACCOUNT_ID`: identificador
  numérico da conta Instagram profissional conectada à Página que autorizou o
  token.
- `INFLUENCER_INTELLIGENCE_SHADOW_CREATOR_HANDLE`: único `@handle` aprovado
  para a jornada posterior `resolve_creator` e `get_profile`.

Para este smoke, o token deve ser de um operador que tem acesso à Página e à
conta profissional conectada, com os escopos de leitura aprovados no app (em
particular `instagram_basic`, `pages_show_list`, `pages_read_engagement` e,
quando disponível, `instagram_manage_insights` e `business_management`). Não
conceder escopos de publicação, mensagens, follow, like ou comentários para
esse gate.

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

## Deploy

O Token Vault é publicado exclusivamente por
`.github/workflows/deploy-token-vault.yml`: Preview -> Staging -> Production.
O workflow exige o gate imutável de promoção, lease global
`release:token-vault`, checkpoint D1 cifrado, migrations aditivas, upload de
versão imutável e readback sanitizado. Preview só emite evidência depois de
testar o Worker e do dry-run; staging exerce a fixture reversível. Em produção,
o workflow exige a source release nativa exata, aplica o Orb inativo com versão
esperada, ativa só então o Worker e termina com o preflight Orb. Ele só atesta
nomes de secrets; não cria nem imprime valores. Não execute `wrangler deploy`,
`secret put` ou migrations remotas manualmente para publicar este serviço.

Antes da primeira promoção, disponibilize em cada GitHub Environment os
segredos independentes exigidos pelo workflow e um perfil de tracking sintético
e autorizado em staging. A ausência de credencial, fixture, checkpoint ou
evidência de staging é um bloqueio fail-closed para produção.

## Import inicial

Exporte a aba `Credencial` como CSV e importe pela API, para que o Worker criptografe antes de gravar no D1:

```bash
TOKEN_VAULT_API_TOKEN=... npm run seed:from-csv -- ./credentials.csv
```

O script não imprime tokens; ele reporta apenas provider, conta externa e tamanho mascarado.
