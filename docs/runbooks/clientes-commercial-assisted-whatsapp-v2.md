# Clientes ? comunica??o comercial assistida v2

## Estado desta tranche

Este artefato define apenas o dom?nio, a migration aditiva, o armazenamento e os testes da comunica??o assistida. N?o h? rota HTTP, cliente de console, worker, template de runtime, flag de ambiente, SDK de provedor, URL `wa.me` ou integra??o de envio nesta tranche. Portanto o dom?nio permanece inalcan??vel e fail-closed ap?s o merge.

Nenhuma mensagem, contato comercial, consentimento ou altera??o de identidade ? enviada ou aplicada por este c?digo. O processo HTTP n?o ganha uma nova rota e nenhum job cont?nuo ? alterado.

## Flags compiladas

As flags n?o s?o lidas de vari?veis de ambiente e devem permanecer exatamente assim:

| Flag | Valor |
| --- | --- |
| `providerSend` | `false` |
| `automationEnabled` | `false` |
| `bulkDispatchEnabled` | `false` |
| `commercialContactWritesEnabled` | `false` |
| `externalDispatch` | `false` |

Uma integra??o futura deve preservar essas flags como default e introduzir uma PR separada para qualquer superf?cie alcan??vel. Ela precisa revalidar permiss?o, expira??o, opt-out, fonte completa/fresh, unidade, can?rio, cooldown e emerg?ncia no instante da a??o humana.

## Migra??o aditiva e revers?vel

O comando ? um CLI nativo com gram?tica fechada: uma a??o (`--dry-run`, `--apply` ou `--rollback`) e, opcionalmente, um target permitido (`local` ou `staging`). Ele n?o avalia shell, SSH, `eval`, comandos de ambiente ou entradas arbitr?rias.

O `DATABASE_URL` ? lido somente da configura??o privada do migrador; nunca deve ser escrito no reposit?rio, logs, artefatos ou issue. Antes de qualquer execu??o, confirme que o release ? um SHA imut?vel e que o destino ? o banco/role permitido pelo validador de destino.

```text
node crm/api/scripts/migrate-atendimento-commercial-assisted-whatsapp.mjs --dry-run --target=local
node crm/api/scripts/migrate-atendimento-commercial-assisted-whatsapp.mjs --apply --target=local
node crm/api/scripts/migrate-atendimento-commercial-assisted-whatsapp.mjs --rollback --target=local
```

Para staging, use somente o target expl?cito e a credencial privada do migrador dedicada:

```text
node crm/api/scripts/migrate-atendimento-commercial-assisted-whatsapp.mjs --dry-run --target=staging
```

Esta PR n?o adiciona a migration ao runner de staging e n?o habilita deploy. A aplica??o em staging exige uma tranche posterior com preflight, backup, evid?ncia de destino, smoke sint?tico e rollback aprovado. Produ??o permanece fora de escopo.

O rollback ? n?o destrutivo: conserva snapshots, attempts, eventos e receipts; fecha os controles de emerg?ncia e registra o rollback no ledger. N?o use `DROP`, `TRUNCATE`, altera??o manual de evid?ncia ou SQL ad hoc para "limpar" o dom?nio.

## Privacidade e auditoria

Somente hashes, refer?ncias opacas de ator, m?scaras de destino e metadados allowlisted podem ser persistidos. Telefone, e-mail, nome de cliente, payload bruto, corpo da mensagem, segredo e token s?o proibidos tanto no dom?nio quanto nas constraints SQL recursivas de JSON/texto.

O sujeito do ator precisa estar em `actorSubject`; campos legados como `id`, `subjectId` ou e-mail n?o s?o aceitos para a refer?ncia audit?vel. N?o inclua PII em justificativas, logs, m?tricas, testes de smoke, tickets ou outputs do operador.

Snapshots de oferta, templates, attempts, eventos, receipts e muta??es de controle s?o append-only. A a??o comercial aceita contexto de oferta apenas uma vez: atualiza??es id?nticas s?o permitidas para replay, e qualquer diverg?ncia entre a??o e snapshot ? rejeitada pelo trigger.

## STOP, replay e emerg?ncia

O dom?nio preparado para webhook aceita somente bytes brutos assinados (raw HMAC), timestamp dentro da janela e payload allowlisted. O receipt ? deduplicado atomicamente por evento e digest do payload; reutiliza??o de um ID de evento com conte?do diferente ? rejeitada. Eventos seguem transi??es monot?nicas.

Um STOP futuro precisa obter o lock compartilhado de telefone antes de gravar o bloqueio de contato e repetir o recebimento n?o pode reabrir ou duplicar a permiss?o. Nesta tranche n?o existe endpoint para invocar esse caminho, logo n?o h? webhook p?blico ou provider configurado.

O controle de emerg?ncia global ou por unidade j? ? modelado, versionado e audit?vel, mas n?o h? UI/rota nesta tranche. Em incidente antes da integra??o futura, mantenha todas as flags acima em `false`, n?o exponha o dom?nio e fa?a rollback n?o destrutivo caso uma migration tenha sido aplicada. N?o invente um SQL operacional manual para rearmar contato.

## Valida??o e smoke sint?tico

A su?te padr?o da API j? descobre os testes em `crm/api/server/atendimento/__tests__/*.test.js`:

```text
npm --prefix crm/api test
```

O teste PostgreSQL ? opt-in. Ele s? abre conex?o quando ambos estiverem configurados no ambiente privado:

- `CRM_ASSISTED_PG_TEST_ENABLED=1`;
- `CRM_ASSISTED_PG_TEST_DATABASE_URL` apontando para loopback e para um banco dedicado cujo nome termina em `_test` ou `-test`.

O teste roda dentro de transa??o e faz rollback. Ele prova, quando o banco dedicado existe, rejei??o de PII direto/aninhado, imutabilidade de snapshot, trigger de contexto da a??o, concorr?ncia de lock de fonte e deduplica??o de receipt STOP. N?o execute com banco compartilhado, staging ou produ??o.

O smoke autorizado nesta tranche ? est?tico/sint?tico: flags false, origem inacess?vel, HMAC sint?tico, corpo sem PII e aus?ncia de URI de envio. N?o realize click-to-send, n?o cadastre consentimento e n?o use qualquer identidade real.

## Pr?xima tranche necess?ria

Uma PR posterior, pequena e revisada, pode conectar rotas internas/UI a este dom?nio. Antes disso ela precisa incluir RBAC, escopo de unidade, assinatura de ator, revalida??o transacional, can?rio vazio por default, HMAC de webhook em segredo privado, observabilidade sem PII, emergency-off operacional allowlisted, testes de regress?o e evid?ncia de staging sint?tico. Automa??o ou envio em massa continuam proibidos.
