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
- Transições para `contacted` usam transação serializável, lock por identidade
  e lock das linhas Harmonia existentes. Conflitos serializáveis são repetidos
  uma vez; falha posterior não marca a ação como contatada.

## Migration

Migration: `20260804_commercial_contact_controls_v1`.

Ela cria `commercial_contact_permissions` e
`commercial_contact_permission_events`, e adiciona o canal de contato às ações
comerciais. O executor
`crm/api/scripts/migrate-atendimento-commercial-contact.mjs` aceita somente o
espelho local `skincos_crm_local`; ele não possui caminho de aplicação remota.

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
5. Promover o backend pela linha de release nativa aprovada e só então o
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
