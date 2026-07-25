# Pacote de piloto do Financeiro — proposta para aprovação nominal

**Estado:** reavaliado em 2026-07-25, ainda bloqueado; não autoriza ativação.
**Maturidade atual:** `experimental`.
**Ambiente:** o pacote só poderá ser usado depois de evidência completa em staging e de uma aprovação nominal independente para produção. Os deploys e canários abaixo são parciais: não autorizam produção.

Este documento é deliberadamente um contrato de revisão. Campos marcados como
`NÃO NOMEADO` impedem a ativação. Não substitua nomes por papéis genéricos,
listas vazias ou herança administrativa.

## Baseline que permanece inalterado

- `finance_settings.module_enabled=false`;
- nenhum grant de piloto/produção será criado, alterado ou removido por este
  pacote;
- o único grant existente em staging é a identidade sintética de monitoramento;
- não há escopo financeiro pessoal, importação histórica automática ou
  liberação global;
- a ativação somente poderá ocorrer depois da aprovação nominal registrada na
  seção final.

## Reavaliação após rollback e restore do SHA atual — 2026-07-25

O SHA candidato exercitado a partir da main foi
`b869485b6a33fae5a5dbe504b41660f842fb4ca9`. O Worker passou pelo preview e
staging canônicos (`30143039262` e `30143051826`) e o rollback independente
(`30143185583`) voltou ao SHA alcançável `8af1d5fe9551891a05a104363043bf3d36fb4ef4`,
Worker `97c7a7da-6a78-44a8-b980-2cc2810df7a0`, sem migrations nem publicação de
outros módulos. O bundle de UI foi gerado do mesmo candidato (`30143580303`,
`30143594297`, artefato `8615284211`). O kill switch remoto foi validado em
`30143674681` e restaurado em `30143742671`; Finance retornou 423/disabled após
a propagação e o shell permaneceu saudável.

O restore scratch isolado importou D1, KV, R2 e Worker com actor sintético.
Contagens de D1 foram iguais antes do exercício (settings 1, scopes 3, grants
1, accounts 0, movements 0, journal 0, audit 13, migrations 12), o smoke
autenticado passou health/readiness/bootstrap/leituras, negação cross-unit,
criação/compensação sintéticas e auditoria, e o intervalo medido do checkpoint
à jornada funcional foi 16 minutos. O scratch foi destruído depois da coleta;
as somas e o relatório sanitizado estão no ledger de evidências e no arquivo
privado do operador.

**Decisão:** os gates de rollback, kill switch e restore scratch estão válidos,
mas o pacote continua `experimental`. Ainda bloqueiam o piloto: download
offsite fresco e auditável de PostgreSQL/configuração (a tentativa atual foi
rejeitada por quota do fornecedor), monitor externo contínuo com alerta humano,
smoke autenticado completo da UI/importação contra uma única versão promovida,
e owner operacional/revisor/unidade/participantes nomeados. `module_enabled`,
grants, usuários, sessões e produção permanecem inalterados.

## Pré-condições bloqueantes

| Gate | Evidência exigida | Situação em 2026-07-25 |
| --- | --- | --- |
| Artefato imutável em staging | SHA, Worker, UI e migrations atestados | **Atendido para staging:** Worker `b869485b…` nos runs `30143039262`/`30143051826`; UI no `30143594297`; migrations e versão foram verificadas. |
| Rollback independente | retorno para SHA anterior, sem usar HEAD, sessão preservada, smoke e RTO medido | **Atendido em staging:** rollback `30143185583` para SHA `8af1d5fe…`, sem migrations ou republicação externa; health/readiness passaram. Sessão de produção não foi tocada. RTO medido é do drill (16 min), não SLO produtivo. |
| Kill switch sem deploy | `disabled` e retorno ao baseline por `module-availability.yml` | **Atendido em staging:** `30143674681` escreveu KV remoto, Finance 423/disabled e shell 200; `30143742671` restaurou active. Propagação observada: ~1–2 min. |
| Jornada autenticada | ator exclusivo, escopo, importação/compensação, auditoria e isolamento | **Parcial:** restore scratch passou actor sintético, leituras, negação cross-unit, criação/compensação e auditoria; falta smoke completo da UI/importação no staging com uma única versão Worker/UI. |
| Observabilidade e alerta humano | monitor contínuo externo, alerta recebido e recuperação registrados | **Bloqueado:** não há evidência anexada de monitor externo contínuo, alerta humano recebido e recuperação. |
| Backup, restore e RTO | cópia offsite, restore isolado e RPO/RTO medidos | **Parcial:** restore scratch Finance D1/KV/R2/Worker passou e RTO do drill foi 16 min; download offsite fresco de PostgreSQL/configuração ainda foi rejeitado por quota, portanto o gate empresarial permanece aberto. |
| Segurança de integração | checks obrigatórios verdes e revisão concluída | PRs #761 e #762 tiveram seus checks obrigatórios concluídos com sucesso; isso não substitui as evidências operacionais pendentes. |

Enquanto qualquer linha estiver bloqueada, o módulo permanece `experimental` e
este pacote serve apenas para revisão.

## Identidades e escopo propostos

| Campo | Proposta | Estado |
| --- | --- | --- |
| Owner técnico | `@jubenitogarcia` | Definido no catálogo técnico; responsável por release, rollback e evidência. |
| Owner operacional | **NÃO NOMEADO** | Deve ser um responsável financeiro da unidade piloto, diferente do owner técnico quando possível. |
| Revisor de liberação | **NÃO NOMEADO** | Deve revisar evidências e não executar a própria aprovação operacional. |
| Unidade piloto | **NÃO NOMEADA** | A unidade sintética `novo-hamburgo` de staging não escolhe nem autoriza uma unidade real. |
| Operador participante | **NÃO NOMEADO** | Um usuário interno, com vínculo à única unidade piloto. |
| Revisor participante | **NÃO NOMEADO** | Um usuário interno separado, somente para conferência. |

Após a aprovação, cada participante receberá somente `allowedModules=finance`
e um `finance_access_grant` explícito para a unidade piloto: `operator` para o
operador e `viewer` para o revisor. Não há escopo pessoal, consolidado, outra
unidade, herança por papel, nem grant administrativo implícito.

## Janela e operação do piloto propostas

| Item | Proposta para aprovação |
| --- | --- |
| Duração | 5 dias úteis consecutivos, sem liberação global. |
| Horário de acompanhamento | Janela diária proposta: 09:00–12:00 BRT; owner técnico e operacional disponíveis. |
| Dados iniciais | Somente plano de contas, contas, categorias, fornecedores/clientes e saldos de abertura da unidade piloto, criados ou importados por lote auditável. Sem histórico automático, dados pessoais, escopo pessoal ou carga em massa. |
| Treinamento | 30 minutos antes da ativação: escopo da unidade, lançamento, revisão, importação controlada, deduplicação, auditoria, indisponibilidade e procedimento alternativo. A presença é registrada no ticket privado. |
| Suporte | **CANAL NÃO NOMEADO**: indicar canal humano privado, plantonista e SLA de resposta antes da ativação. Toda ocorrência recebe `request_id` e registro sanitizado. |
| Procedimento alternativo | Livro/planilha controlada da unidade, com identificador de referência; durante indisponibilidade, não fazer dual-write automático. Ao retorno, o operador reconcilia e registra cada lançamento uma vez. |
| Comunicação | Enviar somente após aprovação: escopo, janela, participantes, o que é permitido, procedimento alternativo, canal de suporte, critérios de abort e aviso de que não há liberação geral. |

## Critérios de sucesso propostos

Todos devem ser atendidos ao fim dos 5 dias úteis:

1. 100% dos lançamentos do piloto conciliados com o procedimento alternativo;
2. zero acesso não autorizado, cruzamento de unidade, duplicação ou divergência
   de dados/auditoria não resolvida;
3. p95 de bootstrap e leituras até 1 s durante a janela observada;
4. health, readiness, dependências e monitor externo saudáveis, com alerta
   humano testado;
5. nenhuma migration, restore ou rollback improvisado;
6. treinamento concluído, suporte disponível e feedback operacional do owner
   registrado; e
7. rollback e restore do mesmo SHA já comprovados em staging, dentro do RTO
   nominal aprovado.

## Critérios de abort e ação imediata

| Gatilho | Ação obrigatória |
| --- | --- |
| Qualquer acesso fora da unidade, escopo pessoal, bypass de grant ou falha de autenticação | Desabilitar a coorte imediatamente, preservar auditoria e abrir incidente. |
| Divergência de razão, importação, deduplicação ou auditoria | Parar novas escritas, usar o procedimento alternativo e iniciar reconciliação. |
| Erro, latência, indisponibilidade de dependência ou falha de jornada acima dos limites de canary aprovados | Executar kill switch ou rollback canônico; não ampliar a coorte. |
| Health/readiness do Financeiro indisponível por mais de 5 minutos na janela | Entrar em manutenção, usar o procedimento alternativo e avaliar rollback. |
| Alerta humano, backup, restore ou rollback sem evidência válida | Não ativar ou abortar o piloto; o gate não pode ser compensado manualmente. |
| Suporte sem owner operacional/revisor disponíveis | Não iniciar ou pausar a janela. |

## Rollback aprovado para execução futura

1. Acionar `disabled`/`maintenance` pelo pipeline canônico de disponibilidade;
2. manter auditoria, migrations e dados; nunca apagar ledger ou idempotência;
3. desativar a coorte sem liberar outros usuários; `module_enabled=false` é o
   kill switch funcional;
4. retornar somente o Worker e, se necessário, o bundle Financeiro ao SHA
   imutável anterior já atestado — sem republicar shell, gateway, Inventory ou
   outros módulos;
5. manter as sessões não revogadas, salvo incidente de segurança que exija
   revogação dirigida;
6. executar smoke, reconciliar as referências anotadas no procedimento
   alternativo e comunicar o encerramento aos participantes.

## Registro de aprovação nominal — obrigatório antes da ativação

Copiar esta seção para o ticket privado de mudança e preencher todos os campos:

```text
SHA e versão Worker/UI atestados:
Evidências de staging, rollback, kill switch, restore e alerta humano:
RPO/RTO medidos e aceitos:
Owner técnico: @jubenitogarcia
Owner operacional (nome e contato):
Revisor (nome e contato):
Unidade piloto (identificador):
Operador participante (identificador):
Revisor participante (identificador):
Canal de suporte e plantonista:
Janela e duração aprovadas:
Dados iniciais aprovados e sua origem:
Treinamento concluído por:
Critérios de sucesso e abort confirmados:
Comunicação aprovada:
Decisão nominal de ativação (data/hora/assinaturas):
```

Sem todos os campos, a decisão é **não ativar**. A futura ativação é uma
mudança operacional separada, com flag e grants explícitos, e não faz parte
deste pacote.
