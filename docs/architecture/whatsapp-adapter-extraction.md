# Fronteira pré-corte do adaptador WhatsApp

**Estado:** pré-corte; não cria repositório, não publica runtime e não move
estado. A fonte executável é
[`adapter-boundary.json`](../../messaging/channels/whatsapp/adapter-boundary.json),
validada por `scripts/validate-whatsapp-adapter-boundary.mjs`.

## O que poderá pertencer a `skincos-whatsapp-adapter`

O único código portável hoje é o cliente HTTP do CRM para a API Evolution e os
seus testes: `evolutionOrchestrator`, o shim legado `whatsappOrchestrator` e
os respectivos testes unitários. Ele preserva a API CRM
`/api/wa-orchestrator/*`, os canais `1..9`, portas legadas `3001..3009`, o
prefixo `crm-channel-` e o destino padrão local `http://127.0.0.1:8080`.

Na migração real, esse conjunto será publicado como pacote privado com versão
exata e consumido pelo CRM. O CRM continuará dono das rotas, autorização,
proxies e de `waMessageMetaStore`; a anotação de conversa no arquivo
`WA_MESSAGE_META_FILE` (`core/wa_message_meta.json` por padrão) não é estado
do adaptador nem do engine.

## Runtime único e dados

Há somente um runtime de canal: `messaging-whatsapp.service`. Ele executa de
`/opt/skincos/current/messaging-whatsapp`, não de checkout, e mantém as
instâncias e o store sob `__STATE_ROOT__/messaging-whatsapp`. Seus logs são
`__LOG_ROOT__/messaging-whatsapp/runtime.out.log` e `runtime.err.log`. Nem o
futuro pacote do adapter nem o CRM podem iniciar outra unidade, process manager
ou cópia de Evolution.

`messaging/channels/whatsapp/engine/**` é explicitamente excluído. O futuro
repositório receberá uma referência a um artefato upstream imutável, com
origem e digest fixados; não receberá o fork nem migrations, banco, sessões ou
arquivos de configuração do engine.

## Custódia, publicação e rollback

Os scripts de release atuais são uma linha de base de custódia, não uma cópia
direta para o novo repositório: hoje eles ainda materializam o engine a partir
do arquivo-fonte do release. Antes de qualquer corte, eles precisam aceitar o
artefato upstream externo fixado por digest e usar a interface assinada de
Platform/Ops, sem copiar o coordenador global.

Os fatos que precisam permanecer são: candidato `release-source-<SHA>`,
predecessor atestado, custódia externa que associa run/artifact/digest antes de
`--apply`, e rollback que restaura o predecessor, reinicia
`messaging-whatsapp.service` e consulta `http://127.0.0.1:8080/health`.

Enquanto esses gates não forem satisfeitos, este boundary falha fechado: não
autoriza criação do repositório, deploy, segredo, alteração de serviço ou
migração de estado.
