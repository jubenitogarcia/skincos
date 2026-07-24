# Pacote de piloto do Financeiro — proposta para aprovação nominal

**Estado:** rascunho bloqueado; não autoriza ativação.
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

## Pré-condições bloqueantes

| Gate | Evidência exigida | Situação em 2026-07-24 |
| --- | --- | --- |
| Artefato imutável em staging | SHA, Worker, UI e migrations atestados | Parcial: o Worker no SHA `fdf8cda8…` foi publicado no run `30111830881`; a evidência do artefato UI correspondente não está anexada a este pacote. |
| Rollback independente | retorno para SHA anterior, sem usar HEAD, sessão preservada, smoke e RTO medido | Parcial: PR #761 foi mergeada e o abort drill `30121676670` restaurou o baseline; falta evidência independente de rollback de UI, sessão e RTO. |
| Kill switch sem deploy | `disabled` e retorno ao baseline por `module-availability.yml` | Evidenciado pelo abort drill `30121676670`, que restaurou o baseline antes de concluir como falha intencional. |
| Jornada autenticada | ator exclusivo, escopo, importação/compensação, auditoria e isolamento | Parcial: canary autenticado de leitura passou no run `30121622991`; ainda falta smoke autenticado de importação e UI. |
| Observabilidade e alerta humano | monitor contínuo externo, alerta recebido e recuperação registrados | Não há evidência de monitor externo contínuo, alerta recebido e recuperação anexada a este pacote. |
| Backup, restore e RTO | cópia offsite, restore isolado e RPO/RTO medidos | Não há evidência de cópia offsite, restore isolado e RPO/RTO anexada a este pacote. |
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
