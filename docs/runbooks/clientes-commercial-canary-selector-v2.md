# Clientes — seletor auditável de canário comercial v2

## Estado e limite desta entrega

O seletor v2 substitui o contrato útil da PR antiga #1164 sem incorporar sua
branch divergente. Ele é um fluxo de seleção e auditoria: **não habilita**
`commercialContactWritesEnabled`, não registra contato e não envia mensagens.
Após cada operação, a política persistida permanece com escrita comercial
desligada e a allowlist legada vazia.

O ambiente autorizado para esta entrega é o espelho local e staging isolado.
Não há promoção de produção, canário real, mensagem, campanha ou escrita
comercial autorizada por este runbook.

## Domínios separados

| Domínio | Responsabilidade | Não faz |
| --- | --- | --- |
| Política comercial | cooldown e faixas de ausência | não abre canário nem altera consentimento |
| Rollout e canário v2 | seleção mascarada, validação, simulação e ledger | não habilita escrita nem envia mensagem |
| Consentimento e bloqueios | permissão, expiração, telefone correlacionado e STOP/Harmonia | não é alterado pelo canário |
| Cadência clínica | regra clínica versionada e aprovada em fluxo próprio | não pode ser aprovada por gestor comercial |

## Pré-requisitos fail-closed

1. Migration `20260807_commercial_canary_selector_v2` aplicada sobre os
   controles comerciais já existentes, com o destino estrito local ou staging
   e role migrator apropriada.
2. O runtime recebe `COMMERCIAL_CANARY_SELECTOR_HMAC_KEY` por overlay privado.
   Registre apenas o nome, nunca o valor. Ausência, valor curto ou chave
   inválida deixa o seletor indisponível; não existe fallback de desenvolvimento.
3. A fila de qualidade possui observação atual de fontes `source.*`. Sem uma
   observação explicitamente saudável, freshness é `unknown` e nenhuma coorte
   pode ser salva.
4. O ator assinado é `GESTOR` e tem escopo explícito da unidade; ADMIN global é
   necessário somente para o emergency-off total. Uma unidade vazia, inválida
   ou fora do claim responde bloqueio.
5. As identidades usadas são sintéticas ou possuem referência explícita de
   aprovação sem PII. A validação é curta (24 h) e usa versão otimista.

## Procedimento local controlado

Antes de qualquer apply, registre em runtime privado: SHA de release, banco
alvo, backup/checkpoint e resultado de `schema_migrations`. Não coloque esses
artefatos no repositório.

O executor local aceita somente uma ação allowlisted e rejeita URL diferente do
espelho Unix-socket do operador. Não aceita shell recebido de variável,
comando arbitrário ou alvo remoto:

```bash
npm --prefix crm/api run migrate-commercial-canary -- --apply
```

Após aplicar, confirme:

```sql
select id, rolled_back_at
from crm_atendimento.schema_migrations
where id = '20260807_commercial_canary_selector_v2';

select commercial_contact_writes_enabled,
       cardinality(commercial_contact_canary_identity_ids) as legacy_allowlist_count
from crm_atendimento.commercial_policy_config
where singleton = true;
```

O resultado esperado é migration ativa, `commercial_contact_writes_enabled =
false` e `legacy_allowlist_count = 0`.

Para staging, use somente o executor controlado existente e a ação
allowlisted `--dry-run`, `--apply` ou `--rollback`; ele valida o loopback TLS,
login migrator e role owner antes de DDL. Nunca use SSH ad hoc, `eval`,
variáveis contendo shell, ou GitHub Environments como veículo de comando.

## Fluxo operacional

1. Selecione uma unidade explícita e busque por cliente. O resultado mostra
   apenas nome mascarado, unidade, qualidade de identidade, permissão, telefone
   correlacionado, opt-out, freshness e motivo; não mostra UUID, telefone ou
   e-mail.
2. Valide cada identidade como `synthetic` ou `explicit_approved`, enviando
   justificativa sem PII, confirmação, versão esperada de política e revisão
   de validação. A referência de aprovação é validada e guardada somente em
   hash HMAC.
3. Selecione refs opacas e com expiração curta. Refs duplicadas, vencidas,
   adulteradas, de outra unidade ou fora do escopo são rejeitadas no backend.
4. Execute a simulação. Ela informa total, elegíveis, bloqueados, em revisão,
   permissões expirando, telefones não correlacionados, fontes stale, decisões
   pendentes e impacto previsto. Impacto permitido nesta tranche é sempre
   `messagesSent=0`, `commercialWritesEnabled=false`, `contactsRecorded=0` e
   `actionsCreated=0`.
5. Só uma simulação integralmente elegível pode ser gravada. O backend volta a
   consultar escopo, identidade, permissão/STOP, phone, freshness e validação
   sob lock do grafo, lock de identidade e lock global do canário.
6. Salve com justificativa, confirmação, versão de política, versão de coorte
   e idempotency key. A seleção cria coorte e ledger append-only; substituição
   de coorte da mesma unidade é atômica e nunca ativa escrita comercial.

## Concorrência, auditoria e privacidade

- `commercial_canary_events` é append-only e protegido contra `UPDATE`,
  `DELETE` e `TRUNCATE`.
- A chave de idempotência é única e seu hash de requisição precisa ser idêntico
  em repetição; outra carga com a mesma chave falha por conflito.
- Coortes usam versão esperada. Duas alterações concorrentes não podem gravar
  sobre a mesma versão.
- O ledger e as métricas guardam apenas hashes de referência de identidade,
  contagens e códigos de estado. PII não é permitido em payload, justificativa
  ou logs operacionais.

## Remoção e emergency-off

`Remover canário da unidade` remove a coorte ativa daquela unidade dentro de
uma transação, limpa a allowlist legada e mantém a escrita desativada. Exige
justificativa, confirmação, versão de política e versão de coorte.

`Emergency off global` exige ADMIN global e a mesma confirmação. Ele compartilha
o lock global com saves, desativa todas as coortes ativas em uma única
transação, limpa a allowlist legada e cria evento append-only. Não envia
mensagens, não altera consentimento e não apaga evidência.

## Rollback

```bash
npm --prefix crm/api run migrate-commercial-canary -- --rollback
```

O rollback é não destrutivo: preserva coortes, validações e ledger; marca a
migration como revertida, força todas as coortes ativas para `emergency_off` e
mantém a escrita e allowlist legada fechadas. Após rollback, o smoke esperado
é seletor indisponível e contatos/mensagens bloqueados.

## Evidência mínima antes de qualquer promoção futura

1. Testes de domínio, migration, rota e console verdes.
2. Apply, repetição idempotente, conflito de versão, seleção duplicada, unidade
   fora de escopo, freshness stale/unknown, opt-out e rollback validados com
   identidade sintética.
3. Smoke autenticado em staging isolado confirma resultado mascarado, a
   simulação e `commercialContactWritesEnabled=false` após salvar/remover/off.
4. Backup/checkpoint, SHA predecessor, resultado de migration, smoke e rollback
   ficam no runtime privado.

Enquanto qualquer item faltar, produção continua fail-closed e não há ação
manual além de configurar a chave privada pelo nome acima e disponibilizar o
runner de staging controlado.
