# Fronteira pré-corte do adaptador WhatsApp

**Estado:** pré-corte; não cria repositório, não publica runtime e não move
estado. A fronteira tem dois controles independentes:

1. O baseline do monorepo, em
   `scripts/validate-whatsapp-adapter-baseline.mjs`, comprova a fonte canônica,
   o SHA/tree revisado, CRM, serviço único, estado, logs, release e rollback.
2. O gate portátil, em
   `scripts/validate-whatsapp-adapter-candidate.mjs`, inspeciona uma closure
   de candidato isolada ou um archive TAR regular. Ele não lê Platform/Ops,
   scripts de release ou estado CRM como dependências ocultas.

O layout portátil explícito está em
[`adapter-boundary.json`](../../messaging/channels/whatsapp/adapter-boundary.json).
Ele inclui somente package metadata privado pre-cut, README, os dois adapters
HTTP do CRM, seus testes e o próprio validador do candidato.

## O que poderá pertencer a `skincos-whatsapp-adapter`

O único código portável hoje é o cliente HTTP do CRM para a API Evolution e os
seus testes: `evolutionOrchestrator`, o shim legado `whatsappOrchestrator` e
os respectivos testes unitários. Ele preserva a API CRM
`/api/wa-orchestrator/*`, os canais `1..9`, portas legadas `3001..3009`, o
prefixo `crm-channel-` e o destino padrão local `http://127.0.0.1:8080`.

Na migração real, esse conjunto será publicado como pacote privado com versão
exata e consumido pelo CRM. O template atual permanece explicitamente privado
na versão pre-cut, sem publishConfig nem script de publicação. O CRM continuará
dono das rotas, autorização, proxies e de `waMessageMetaStore`; a anotação de
conversa no arquivo `WA_MESSAGE_META_FILE` (`core/wa_message_meta.json` por
padrão) não é estado do adaptador nem do engine.

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

## Gate de candidato e evidência

Antes de qualquer criação de repositório ou publicação, o candidato precisa ser
validado com um diretório isolado ou um TAR regular e um documento de evidência
externo pelo runner canônico do monorepo. O runner fixa a SHA-256 revisada do
validador portátil antes de inspecionar o candidato; a cópia do validador que
viaja na closure não é uma raiz de confiança e não pode aprovar a si mesma. O
gate confere:

- SHA e tree de origem pinados;
- SHA-256 dos dois adapters e dos seus testes, amarrados ao baseline revisado;
- digest determinístico da closure e, para TAR, digest do archive bruto;
- ausência de Evolution, estado de mensagem CRM, rota CRM, serviço, runtime,
  workflow ou script de release;
- os quatro fatos: pacote privado exato para CRM, artefato upstream pinado,
  custódia assinada Platform/Ops, e único publicador/serviço com staging e
  rollback comprovados.

O comando de autoridade normal falha fechado enquanto o status for pre-cut:

    node scripts/validate-whatsapp-adapter-baseline.mjs --candidate <directory-or-tar> --evidence <external-evidence.json>

Mesmo evidência forjada como "proven" não permite criação ou publicação antes
de uma alteração revisada de status e dos quatro fatos reais. Nenhum dos dois
validadores cria repositório, deploy, serviço, segredo ou migração de estado.
