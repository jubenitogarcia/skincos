# Clientes ? comunica??o comercial assistida v2

## Estado desta tranche

O dom?nio, a migration aditiva, o armazenamento e uma superf?cie HTTP m?nima de Clientes est?o versionados. As rotas exigem ator assinado, papel `GESTOR`, escopo de unidade e um sujeito opaco derivado somente de `subject`, `subjectId` ou `id`; e-mail e username n?o s?o aceitos como identidade de auditoria.

O console expõe apenas uma leitura contextual de ofertas e modelos aprovados no perfil endereçado. O preview e a confirmação permanecem bloqueados pelas flags compiladas e pelo runtime somente leitura; não há reveal de destino, URI de envio, SDK de provedor, worker, rota de webhook ou dispatch nesta tranche.

Nenhuma mensagem, contato comercial, consentimento ou altera??o de identidade ? enviada ou aplicada por este c?digo. O processo HTTP n?o ganha automa??o nem job cont?nuo.

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

O runner de staging registra a migration apenas depois de source operations e do seletor de can?rio. Esta altera??o n?o executa o runner, n?o aplica migration, n?o habilita deploy e n?o abre escrita comercial. Staging ainda exige preflight, backup, destino/role comprovados, smoke sint?tico e rollback; produ??o permanece fora de escopo t?cnico.

O rollback ? n?o destrutivo: conserva snapshots, attempts, eventos e receipts; fecha os controles de emerg?ncia e registra o rollback no ledger. N?o use `DROP`, `TRUNCATE`, altera??o manual de evid?ncia ou SQL ad hoc para "limpar" o dom?nio.

## Privacidade e auditoria

Somente hashes, refer?ncias opacas de ator, m?scaras de destino e metadados allowlisted podem ser persistidos. Telefone, e-mail, nome de cliente, payload bruto, corpo da mensagem, segredo e token s?o proibidos tanto no dom?nio quanto nas constraints SQL recursivas de JSON/texto.

O sujeito do ator precisa estar em `actorSubject`; campos legados como `id`, `subjectId` ou e-mail n?o s?o aceitos para a refer?ncia audit?vel. N?o inclua PII em justificativas, logs, m?tricas, testes de smoke, tickets ou outputs do operador.

Snapshots de oferta, templates, attempts, eventos, receipts e muta??es de controle s?o append-only. A a??o comercial aceita contexto de oferta apenas uma vez: atualiza??es id?nticas s?o permitidas para replay, e qualquer diverg?ncia entre a??o e snapshot ? rejeitada pelo trigger.

## STOP, replay e emerg?ncia

O dom?nio preparado para webhook aceita somente bytes brutos assinados (raw HMAC), timestamp dentro da janela e payload allowlisted. O receipt ? deduplicado atomicamente por evento e digest do payload; reutiliza??o de um ID de evento com conte?do diferente ? rejeitada. Eventos seguem transi??es monot?nicas.

N?o h? endpoint de webhook nesta tranche: ele ser? exposto apenas junto de um ingress dedicado, autenticado, rate-limited e compat?vel com o runtime somente leitura. Um STOP futuro precisa obter o lock compartilhado de telefone antes de gravar o bloqueio de contato e repetir o recebimento n?o pode reabrir ou duplicar a permiss?o.

O controle de emerg?ncia global ou por unidade ? modelado, versionado e audit?vel. A rota autenticada de gestor continua sujeita ao runtime somente leitura; o rearm exige confirma??o expl?cita e vers?o esperada. Em incidente, mantenha todas as flags acima em `false`, n?o exponha transporte externo e fa?a rollback n?o destrutivo caso uma migration tenha sido aplicada. N?o invente SQL operacional manual para rearmar contato.

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

O console agora apresenta ofertas e modelos aprovados para a ação selecionada, destinatário mascarado e a confirmação literal. As flags compiladas continuam em false, portanto os controles mutáveis permanecem desabilitados e o painel não emite transporte externo. Uma PR posterior, pequena e revisada, pode introduzir reveal temporário/auditado; ele precisa continuar one-time, justificado e sem URI de provedor. O ingresso de webhook também fica separado: deve manter raw HMAC, replay, rate limit, STOP imediato e bloqueio explícito no runtime somente leitura. Automação, disparo em massa e envio autônomo continuam proibidos.
