# Gateway de produção do CRM Core

Esta mudança prepara somente o caminho privado do Worker `skincos-api` para
encaminhar `https://api.skincos.com.br/crm/*` ao CRM Core independente. Ela
não publica uma rota nova, não troca o Pages atual, não toca `/api/crm/*` e
não desativa o runtime legado.

## Estado inicial seguro

O manifesto mantém `CRM_CORE_PRODUCTION_ENABLED=false` e
`CRM_IDENTITY_ISSUER_CALLER_ENABLED=false`. O binding privado para o Core já
existe, mas o binding de produção `IDENTITY_CRM_ISSUER` é deliberadamente
adiado: o Wrangler resolve o alvo durante o upload mesmo com os flags
desligados. Assim, um deploy normal do gateway não pode falhar por depender de
um Worker Identity ainda não criado/deployado. Sem o flag, o recibo assinado,
o anel de chaves e o HMAC externos, qualquer rota `/crm/*` continua falhando
fechada.

O gateway só aceita uma sessão ou leitura de projeções de produção quando um
recibo externo, assinado e verificado localmente fixa **as três versões**:

- `G`: a versão em execução de `skincos-api`;
- `C`: a versão imutável e o artefato do `skincos-crm-core`;
- `I`: a versão imutável de `skincos-identity-crm-delivery-production`.

O próprio recibo não fica em uma variável do API Worker (isso criaria uma
dependência auto-referente em `G`). O gateway pede somente
`gatewayVersionId` ao endpoint privado
`/internal/crm-production-route-receipt/v1/resolve` do Identity, por HMAC e
sem repassar cookie, `Authorization`, ator ou cabeçalho do navegador. Identity
devolve o recibo externo guardado em seu segredo de runtime; o API valida a
assinatura Ed25519 com chaves de prefixo
`crm-production-route-receipt-*`, distinto da chave de entrega Identity.

Depois disso, o API prova `/ready` do Core com o override de `C`, emite o
envelope de identidade pelo binding privado com o override de `I`, e encaminha
a requisição ao Core com o override de `C`. O canal de consulta do recibo não
é pinado porque serve apenas para entregar um artefato já assinado; retirar ou
alterar esse recibo faz o API negar a rota. A emissão do envelope, que tem
efeito de autorização, sempre é pinada em `I`.

Para evitar uma nova auto-referência, a versão que resolve o recibo (`R`) pode
ser uma versão privada ativa do mesmo Worker Identity, mas não é `I`: `R`
guarda somente o HMAC e o segredo do recibo, enquanto `I` já foi carregada e
tem a chave de emissão. Os papéis usam flags mutuamente exclusivos em cada
versão imutável: `R` responde `404` para emissão/publicação de chaves, mesmo
se uma chave for ligada por engano; `I` responde `404` para a resolução, mesmo
se o segredo do recibo for ligado por engano. Se ambos os flags forem ligados
ou desligados em uma versão habilitada, nenhuma superfície é exposta. O API usa `R` sem override
apenas para ler o artefato externo e usa `I` por override para emitir envelopes.
O endpoint de resolução não carrega nem usa a chave de emissão.

O navegador nunca escolhe `I`: o API descarta qualquer
`cloudflare-workers-version-overrides` recebido do cliente e cria um novo
cabeçalho privado somente após verificar a assinatura do recibo e associá-lo
ao ambiente em memória. Assim, mudar `I`, `G` ou `C` depois da assinatura faz
a rota falhar antes de chamar Core ou emitir um envelope.

## Origem do navegador

Em produção, CORS de sessão e projeções aceita exclusivamente
`https://crm.skincos.com.br`. Staging preserva as duas origens de staging.
Nenhum Pages preview, origem de staging ou cabeçalho de identidade enviado pelo
navegador é reutilizado na produção.

## Próximas condições operacionais

Antes de ligar os flags externos, são necessários: versão do Core com D1 e
anel público corretos, Worker Identity com chave não extraível, HMAC comum
custodiado fora do Git, recibo assinado que prenda `G`, `C`, `I` e `/ready`, e
uma versão independente do console que aceite a origem e API de produção.
Essas condições são deploys e provas operacionais separados desta mudança de
fonte.

O binding de produção do Identity entra apenas em um candidato de cutover
revisado, nesta ordem: (1) criar o Worker Identity privado e carregar a
versão de emissão `I`, com custódia/rollback comprovados, (2) carregar o
candidato API com o binding e flags ainda desligados para registrar `G`,
(3) comprovar o candidato Core `C`, (4) assinar externamente o recibo para
`G`, `C` e `I`, (5) publicar a versão resolutora `R` do Identity com o segredo
do recibo e `IDENTITY_CRM_DELIVERY_PRODUCTION_ISSUER_ENABLED=false`, sem usar
a chave de emissão, (6) confirmar que `I` usa
`IDENTITY_CRM_DELIVERY_PRODUCTION_ROUTE_RECEIPT_RESOLVER_ENABLED=false`, e
(7) executar os smokes privados.
Nenhuma dessas etapas é acionada por este commit.

O input de assinatura do recibo é a sequência de linhas
`contract`, `receiptId`, `environment`, `gatewayVersionId`, `service`,
`workerVersionId`, `identityWorkerVersionId`, `release`, `artifactDigest` e
`keyId`, nessa ordem. A assinatura e seu material privado nunca entram neste
repositório.

O readback de aposentadoria do writer CRM legado pertence à janela de troca:
ele ocorre **depois** de desativar o writer legado e **antes** de o sucessor
aceitar escrita de produção. Isso produz a prova `legacyRetired=true` exigida
pelo gate do Core; não é uma verificação posterior à troca.
