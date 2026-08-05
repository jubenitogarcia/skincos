# Clientes — controles de contato comercial

## Objetivo

O módulo Clientes consolida fontes de Atendimento, Caixa, cadastros do app e
leads suplementares para formar filas comerciais assistidas. Este rollout torna
o contato por WhatsApp explicitamente governado: uma ação só pode ser marcada
como `contacted` depois de haver telefone correlacionado, permissão registrada
e ausência de opt-out no Harmonia.

O módulo não envia mensagens nem altera dados clínicos. `contacted` é um
registro de operação comercial; o integrador que vier a disparar mensagens deve
reavaliar a elegibilidade imediatamente antes do envio.

## Controles implementados

- Identidades de fonte única são mantidas como `unresolved_single_source`; só
  evidência entre fontes confirmada promove uma identidade consolidada.
- A fila expõe cobertura de identidade, itens de venda sem classificação e
  estado agregado de elegibilidade sem devolver o número telefônico usado na
  correlação.
- A permissão exige `granted` ou `denied`, fonte e referência de evidência.
  Uma concessão pode ter expiração futura; um bloqueio não expira
  silenciosamente.
- Opt-out do Harmonia prevalece sobre uma permissão local. Fonte de bloqueios,
  telefone não correlacionado ou controles de banco indisponíveis resultam em
  `review_required`, nunca em contato permitido.
- A gravação de permissão exige identidade individual do operador e cria evento
  imutável de permissão, além do evento de auditoria geral. Referências de
  evidência não levam telefone bruto ao audit log.
- Transições para `contacted` usam `READ COMMITTED` explícito, lock por
  identidade e uma trava compartilhada e ordenada por telefone com o Harmonia.
  O Harmonia adquire a mesma trava antes de criar ou marcar um opt-out,
  cobrindo também o primeiro `STOP` quando ainda não há linha de contato. A
  leitura após uma espera de trava vê a revogação ou bloqueio já confirmado;
  falha posterior não marca a ação como contatada.
- A cadência é consumida somente quando o contato é efetivamente registrado em
  `contacted_at`, nunca quando uma fila é criada. A transição consulta todos os
  contatos anteriores da identidade dentro da janela e as transições
  concorrentes compartilham a mesma trava por identidade; somente uma pode
  consumir a janela de cadência. Estados legados como resposta, agendamento,
  venda ou retorno não contam como contato sem um `contacted_at` explícito.
- O registro de contato e a concessão de uma nova permissão começam desligados.
  Para abrir um canário, um GESTOR precisa habilitar explicitamente o rollout e
  selecionar na própria fila apenas identidades materializadas e visíveis que
  estejam elegíveis. O backend continua validando a allowlist persistida por
  UUID, mas a UI não aceita uma lista manual de identificadores. Negar uma
  permissão continua disponível mesmo fora do canário. O rollout libera
  somente registros no CRM; ele não envia mensagens.
- A política expõe uma versão opaca. A UI só envia campos de canário quando eles
  foram realmente alterados e acompanha a versão lida; uma atualização
  concorrente responde conflito em vez de reabrir, fechar ou esvaziar um
  canário com valores desatualizados.

## Migration

Migration: `20260804_commercial_contact_controls_v1`.

Ela cria `commercial_contact_permissions` e
`commercial_contact_permission_events`, e adiciona o canal de contato às ações
comerciais. O executor
`crm/api/scripts/migrate-atendimento-commercial-contact.mjs` aceita somente o
espelho local `skincos_crm_local` pelo socket Unix do operador `admin`; ele não
possui caminho de aplicação remota.

Aplicação local, depois de backup privado:

```bash
npm --prefix crm/api run migrate-commercial-contact -- --apply
```

A reversão é não destrutiva: remove apenas os índices de consulta e marca a
migration como revertida. Permissões e eventos são preservados para manter a
rastreabilidade.

```bash
npm --prefix crm/api run migrate-commercial-contact -- --rollback
```

Migration complementar: `20260804_commercial_contact_rollout_v1`.

Ela adiciona `commercial_actions.contacted_at`, o índice de consulta de
cadência e os campos de rollout desligado por padrão em
`commercial_policy_config`. Ela depende da migration de controles anterior e
aceita somente `skincos_crm_local` pelo socket Unix do operador `admin`, via
executor abaixo:

```bash
npm --prefix crm/api run migrate-commercial-contact-rollout -- --apply
```

A aplicação só reaproveita timestamps existentes de ações explicitamente
marcadas `contacted`; ela não infere contato de respostas, agendamentos, vendas
ou retornos. O executor verifica e repara índice inválido antes de registrar o
resultado. A flag começa em `false` e a allowlist começa vazia.

Sua reversão também é não destrutiva: mantém timestamps, desliga a flag, limpa
a allowlist, remove apenas o índice de consulta e marca a migration como
revertida.

## Dados e reconciliação

Antes de promover uma fonte nova, execute a reconciliação em modo seco e
revise sugestões ambíguas. A reconciliação só deve ser aplicada quando o CSV ou
conector de origem estiver identificado e versionado no processo operacional.
Não transforme sugestão de grafia ou de telefone em merge automático.

Itens de venda sem classificação permanecem visíveis como pendência de
qualidade e não entram em recomendação de procedimento. Clientes de
Atendimento ainda sem identidade também permanecem na métrica de cobertura;
não devem ser descartados para melhorar o painel artificialmente.

## Pré-requisitos para staging ou produção

1. Definir uma rota controlada para aplicar a migration no Postgres remoto,
   com backup, timeout, verificação de `schema_migrations` e rollback
   documentado.
2. Validar a fonte Harmonia e o formato normalizado de telefone no ambiente
   alvo. Ausência da tabela ou de correlação deve continuar bloqueando contato.
3. Garantir que o proxy Pages tenha `ATENDIMENTO_API_TARGET` e a assinatura de
   ator configurados; o backend deve receber identidade individual do operador.
4. Validar em staging, com identidade sintética, os casos: sem permissão,
   permissão expirada, bloqueio, opt-out Harmonia e permissão concedida.
5. Antes de qualquer canário, comprovar que `contacted_at`, a allowlist e a
   flag de rollout estão presentes; a flag deve iniciar desligada e a allowlist
   vazia. Testar duas ações sintéticas concorrentes para confirmar que somente
   uma transição pode registrar `contacted` na mesma janela.
6. Promover o backend pela linha de release nativa aprovada e só então o
   frontend compatível. A UI nova continua segura contra backend ainda sem os
   campos de contato: ela apresenta revisão e não libera `contacted`.

## Verificação mínima

```bash
npm --prefix crm/api test
npm --prefix crm/console run test
npm --prefix crm/console run lint
npm --prefix crm/console run build
```

No ambiente local, use o launcher de CRM com um alvo de API de Atendimento
privado e local. Se `ATENDIMENTO_API_TARGET` não estiver configurado, o proxy
deve responder 503 explícito e o módulo não deve operar contra um destino
implícito.

## Estado de promoção

Esta mudança fica tecnicamente inelegível para staging ou produção enquanto não
existir a rota controlada de migration do CRM remoto. A ausência desse caminho
é um bloqueio de infraestrutura, não uma autorização para aplicar DDL por
acesso ad hoc.
