# Gateway de produção do CRM Core

Esta mudança prepara somente o caminho privado do Worker `skincos-api` para
encaminhar `https://api.skincos.com.br/crm/*` ao CRM Core independente. Ela
não publica uma rota nova, não troca o Pages atual, não toca `/api/crm/*` e
não desativa o runtime legado.

## Estado inicial seguro

O manifesto mantém `CRM_CORE_PRODUCTION_ENABLED=false` e
`CRM_IDENTITY_ISSUER_CALLER_ENABLED=false`. Os dois service bindings privados
existem para que uma versão futura possa ser auditada, mas sem o flag, o
recibo assinado, o anel de chaves e o HMAC externos qualquer rota `/crm/*`
continua falhando fechada.

O gateway só aceita uma sessão ou leitura de projeções de produção quando o
mesmo recibo já validado pelo roteador fixa a versão imutável de
`skincos-crm-core`. A entrega de identidade segue pelo binding privado
`skincos-identity-crm-delivery-production`; o perfil exige
`crm-api-production-v1` e somente IDs de chave `crm-production-*`.

## Origem do navegador

Em produção, CORS de sessão e projeções aceita exclusivamente
`https://crm.skincos.com.br`. Staging preserva as duas origens de staging.
Nenhum Pages preview, origem de staging ou cabeçalho de identidade enviado pelo
navegador é reutilizado na produção.

## Próximas condições operacionais

Antes de ligar os flags externos, são necessários: versão do Core com D1 e
anel público corretos, Worker Identity com chave não extraível, HMAC comum
custodiado fora do Git, recibo assinado que prenda as duas versões e `/ready`,
e uma versão independente do console que aceite a origem e API de produção.
Essas condições são deploys e provas operacionais separados desta mudança de
fonte.
