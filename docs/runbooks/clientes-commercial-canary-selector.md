# Clientes — seletor operacional do canário comercial

## Escopo

O canário comercial é uma coorte versionada e auditável. A política comercial
define apenas cooldown/faixas; o seletor controla rollout; consentimento é
mantido no ledger de permissões; cadência clínica permanece sob o fluxo clínico.
Gestores comerciais não aprovam regras clínicas.

O comportamento inicial é fail-closed:

- `commercialContactWritesEnabled=false`;
- a coorte pode ser consultada e simulada, mas nenhuma mensagem é enviada e
  nenhum contato é registrado;
- a interface não exibe UUID, telefone ou e-mail;
- uma identidade só pode entrar se estiver em unidade permitida, com identidade
  sintética ou aprovação explícita vigente, telefone correlacionado, permissão
  válida, sem opt-out e sem fonte stale;
- nenhuma ausência em fonte aposenta uma identidade.

## Preparação local/staging

Execute a migration somente com a role de migration e destino explicitamente
permitido:

```text
npm --prefix crm/api run migrate-commercial-canary -- --apply
```

O script aceita somente o socket local administrado pelo runtime. Para staging,
use o executor de migration autorizado do ambiente com o mesmo SHA; não passe
comandos, SSH, `eval` ou shell por variável de ambiente.

## Operação na interface

1. Abra `Clientes > Governança > Rollout e canário`.
2. Pesquise por cliente e refine unidade, qualidade, permissão, telefone e
   freshness. Os resultados são mascarados e a referência autenticada/cifrada
   expira em dez minutos; o UUID bruto não fica codificado em claro no ref.
3. Selecione identidades sintéticas ou registre aprovação explícita com motivo.
4. Execute **Simular alteração**. A simulação mostra total, elegíveis,
   bloqueados, revisão, expirações, telefones não correlacionados, fontes stale,
   decisões pendentes e impacto previsto.
5. Informe justificativa, confira a versão de política/coorte e confirme
   explicitamente. O servidor repete todas as validações dentro de uma
   transação com lock e CAS.

## API operacional

- `GET /commercial/canary/state`
- `GET /commercial/canary/candidates`
- `POST /commercial/canary/preview`
- `POST /commercial/canary/identities/validate`
- `POST /commercial/canary`
- `POST /commercial/canary/remove`
- `POST /commercial/canary/emergency-off`
- `POST /commercial/canary/rollback`

Escritas exigem `justification`, `confirm=true`, `expectedPolicyVersion`,
`expectedCohortVersion` (quando aplicável) e `idempotencyKey`. Repetição com a
mesma chave devolve o resultado anterior; outra carga com a mesma chave falha.
Uma versão ou fonte alterada entre simulação e aplicação falha sem alteração
parcial.

## Emergency off e rollback

**Emergency off** desativa escrita comercial, esvazia a compatibilidade legada,
marca a coorte como `emergency_off` e grava um evento append-only na mesma
transação. É a remoção total do canário em uma operação.

**Rollback** restaura uma coorte histórica por versão, exige política/coorte
atuais e justificativa, preserva os eventos e mantém mensagens em zero. O
servidor revalida todos os membros no momento do rollback; se qualquer
identidade estiver stale, sem validação vigente, fora do escopo ou sem
consentimento elegível, a operação falha sem alteração parcial.

## Auditoria e observabilidade

As tabelas `commercial_canary_events` e
`commercial_canary_validation_events` são append-only. Payloads operacionais
contêm somente contagens, hashes e estados allowlisted; nomes, telefones,
e-mails e listas de IDs são rejeitados pelo schema. O painel operacional deve
acompanhar versão ativa, contagem, elegíveis/bloqueados/revisão, freshness e
último evento. Finding de fonte preventiva deve ser aberto antes de 24 horas e
alto após 48 horas pelo refresh de qualidade já existente.

## Rollback da migration

O rollback é não destrutivo: registra o estado em `schema_migrations` e preserva
coortes/evidências. Não remova tabelas manualmente; uma remoção acidental
destruiria a trilha necessária para auditoria.

## Smoke sintético

O smoke deve usar apenas identidades sintéticas, confirmar que a listagem não
contém PII, executar preview e repetição idempotente, provocar conflito de
versão, verificar bloqueio por unidade/fonte stale e executar emergency off.
Confirme nos eventos que `messages_sent=0` e
`commercialContactWritesEnabled=false`. Não promova a produção nesta tranche.
