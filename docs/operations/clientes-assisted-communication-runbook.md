# Clientes — ofertas aprovadas e comunicação assistida

## Escopo operacional

Esta tranche adiciona contexto de oferta imutável às ações comerciais e um fluxo de
WhatsApp exclusivamente assistido. O sistema prepara um compositor `wa.me` depois de
uma confirmação humana explícita; ele não chama provedor, não envia mensagem sozinho e
não oferece disparo em massa.

O catálogo atual do `main` é a fonte de verdade. A auditoria encontrou a PR antiga
`#816` (`codex/admin/meta-ads-crm-commercial-catalog`) ainda aberta e muito divergente
do `main`; ela não foi incorporada. Os contratos úteis já integrados nas PRs mescladas
`#822`/`#823` foram reaproveitados sobre o `main` atual. A substituição fica registrada
neste runbook para evitar reintrodução da branch antiga.

## Migração local/staging

Use somente um banco local ou staging isolado e o runner allowlisted:

```text
ATENDIMENTO_MIGRATION_TARGET=local DATABASE_URL=<banco-local> npm run migrate-commercial-assisted-communication -- --apply
ATENDIMENTO_MIGRATION_TARGET=staging DATABASE_URL=<banco-staging-isolado> npm run migrate-commercial-assisted-communication -- --apply
```

O destino é validado pelo runner antes da conexão e a migração aditiva exige as
relações-base de Atendimento, catálogo, ações, permissões e política. O rollback é
não destrutivo: marca a migration como revertida e preserva snapshots, tentativas,
eventos e controles para investigação.

O schema cria:

- `commercial_offer_revisions`: snapshot append-only da revisão, preço, condições,
  validade, unidade e hash do contexto usado na ação;
- `commercial_whatsapp_templates`: templates aprovados e versionados, com vigência e
  escopo opcional de unidade;
- `commercial_whatsapp_attempts`: tentativa idempotente, telefone apenas como hash e
  máscara, campanha, oferta e revisão;
- `commercial_whatsapp_events`: eventos append-only e chave externa única;
- `commercial_contact_emergency_controls`: emergency off global ou por unidade.

O papel de runtime pode ler catálogo/contexto e inserir evidência. Não recebe permissão
de envio de provedor, alteração de evidência, DDL ou execução arbitrária.

## Oferta contextual

Uma ação só grava oferta quando ela pertence à unidade, está aprovada/ativa, dentro da
vigência atual, possui aprovação registrada e tem pelo menos um procedimento
classificado compatível com a identidade. O contexto completo e o hash são capturados
antes da ação; alterações posteriores do catálogo não reescrevem o histórico.

O endpoint de seleção é `GET /api/atendimento/offers?status=approved_active&unit=<slug>`.
O frontend filtra novamente a vigência, mas a validação autoritativa é feita no banco.
Nenhum texto de oferta é tratado como recomendação clínica.

## Click-to-send humano

1. O gestor escolhe um template aprovado e vigente.
2. `POST /commercial/whatsapp/preview` exibe somente destinatário mascarado, oferta,
   campanha, permissões, freshness e estado dos bloqueios.
3. A confirmação exige exatamente `CONFIRMAR_ENVIO_ASSISTIDO`.
4. `POST /commercial/whatsapp/confirm` obtém lock por identidade, verifica unidade,
   oferta/revisão/hash, permissão, expiração, telefone correlacionado, freshness,
   cooldown/frequency cap, canário, policy e emergency off. A chave de idempotência é
   única; uma segunda tentativa dentro da janela é recusada.
5. A tentativa é gravada com status `confirmed` e uma evidência `confirmed`; só então o
   browser abre o compositor do WhatsApp. O ator ainda precisa clicar em enviar no
   aplicativo.

Não registrar telefone, e-mail, corpo de mensagem com PII, token, segredo ou URL de
webhook em logs, métricas ou artefatos. A resposta com `clickToSendUrl` só é produzida
após a confirmação explícita e não é persistida.

## Webhooks autorizados

`POST /api/atendimento/internal/commercial/whatsapp/webhook` é uma interface interna.
Configure apenas o nome da variável `COMMERCIAL_WHATSAPP_WEBHOOK_SECRET` no ambiente
autorizado. A assinatura é HMAC-SHA256 base64url sobre:

```text
<x-commercial-whatsapp-timestamp>.<providerEventKey>.<JSON canônico do payload>
```

O timestamp tem tolerância de cinco minutos e a `providerEventKey` é única. Eventos
`sent`, `delivered`, `read`, `replied`, `failed` e `stop` atualizam a tentativa de forma
idempotente. `stop` grava imediatamente o bloqueio de WhatsApp no ledger de permissões
e gera auditoria append-only.

## Emergency off e rollout

`GET/PUT /commercial/contact/emergency-off` expõe o estado global ou de uma unidade
permitida. O controle é fail-closed: global ou unidade ativa bloqueia a confirmação.
O rollout continua desativado por padrão (`commercialContactWritesEnabled=false` e
canário vazio); nenhuma mensagem real deve ser usada para smoke. Testes usam somente
identidades sintéticas e banco local/staging isolado.

## Validação e rollback

```text
# API
node --test server/atendimento/__tests__/commercialAssistedCommunicationMigration.test.js server/atendimento/__tests__/routes.test.js

# console
npm run typecheck
npm run test -- tests/clientCommercialAssistedCommunication.test.ts tests/clientCommercialWorkspace.test.ts
npm run build
```

Valide também no ambiente isolado: preview sem PII, confirmação idempotente repetida,
falha de freshness, emergency off, rollback da migration e webhook STOP duplicado. A
ausência de template, permissão, telefone único, canário ou fonte saudável deve resultar
em bloqueio explícito; não há fallback para envio.
