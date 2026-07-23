# Política operacional de mudanças

**Status:** obrigatória  
**Aplica-se a:** todo código, configuração, migration, workflow, feature flag, integração ou operação que possa alterar comportamento em staging ou produção.  
**Fonte de execução:** complementa `AGENTS.md`; em conflito, prevalece a instrução mais restritiva.

## 1. Unidade de trabalho: branch e PR curtos

- Cada branch e PR deve ter **um objetivo operacional verificável** e responsável técnico claro.
- O branch usa `codex/admin/<task-slug>` e parte de uma base atualizada.
- O PR não mistura refatoração ampla, mudança funcional, migration e infraestrutura sem uma dependência demonstrada.
- Se partes tiverem rollout, rollback ou validação diferentes, elas são PRs separados.
- Alterações não relacionadas no worktree são preservadas e não entram no PR.
- O PR descreve objetivo, superfícies, risco, flag, migration, validações e rollback. Sem esses itens, permanece draft.

## 2. Módulos não liberados não são publicados automaticamente

- Todo módulo novo ou ainda não liberado começa **desativado por padrão**.
- Merge, push em `main`, reconcile, deploy de infraestrutura ou atualização de dependência não autoriza ativar UI, rota mutável, workflow, grant ou dado de módulo não liberado.
- Exposição a uma coorte exige, de forma independente:
  1. flag global do módulo;
  2. grant explícito de módulo ao usuário ou serviço;
  3. escopo explícito de unidade/dado, quando aplicável;
  4. deploy/versionamento do domínio comprovado;
  5. registro de validação pré-produção.
- Papel genérico, lista vazia, feature flag de frontend ou URL direta não são bypass de autorização.
- Pipeline que possa publicar módulo não liberado exige guarda explícita e falha fechada quando faltar autorização de release. A guarda registra o motivo de skip sem vazar segredos.
- Ativar workflow com efeito externo, grant, rota de escrita ou flag de produção é mudança de produção, mesmo sem novo deploy.

## 3. Migrations: somente aditivas

- Migration de produção é aditiva e reversível no nível operacional: tabela, coluna nullable, índice, view, trigger ou configuração inicial são permitidos quando não removem nem reinterpretam dados existentes.
- É proibido em uma única entrega: `DROP`, renomear/remover coluna em uso, reduzir tipo/tamanho, tornar campo obrigatório sem backfill validado, reescrever histórico, apagar dados ou alterar semântica de ledger/auditoria.
- Mudança incompatível usa expandir -> backfill idempotente -> dual-read/dual-write quando necessário -> validação -> corte posterior -> remoção em entrega posterior.
- Antes do apply remoto, registrar banco alvo, versão anterior, backup/checkpoint, comando de apply, rollback e consulta de verificação.
- Migration só vai a produção depois de staging equivalente, testes de idempotência e validação de dados/métricas proporcionais ao risco.

## 4. Rollback é pré-requisito

Antes de produção, o PR ou registro de release declara:

| Item | Obrigatório |
| --- | --- |
| Superfície e versão atual | sim |
| Versão, deployment ou release de retorno | sim |
| Gatilhos objetivos para rollback | sim |
| Responsável e comando/ação de rollback | sim |
| Impacto e estratégia para dados | sim |
| Smoke após rollback | sim |

- Rollback de código usa versão/deployment/release anterior comprovado.
- Rollback de dados não apaga histórico, ledger, auditoria ou evidência. Se reversão de dado não for segura, desativar flag, bloquear escrita e recuperar de backup/checkpoint aprovado.
- Nenhuma promoção é concluída sem prova de que o rollback identificado é executável.

## 5. Feature flags e coortes

- Flags são server-side, auditáveis e com default seguro: módulo, escrita, automação e integração externa começam desativados.
- A UI reflete a autorização do servidor; nunca é a única barreira.
- Grants são explícitos, mínimos e revogáveis. Não há herança automática de escopo financeiro, pessoal ou de unidade.
- Cada flag tem owner, propósito, escopo, default, critério de ativação, métrica/smoke e condição de remoção.
- Flag de emergência deve parar o efeito de negócio sem novo deploy e sem expor dados fora do escopo.

## 6. Testes proporcionais ao risco

| Nível | Exemplos | Mínimo obrigatório |
| --- | --- | --- |
| Baixo | texto, documentação, estilo sem runtime | diff check e validação estática relevante |
| Médio | lógica isolada, componente, contrato interno | testes unitários/contrato e build/typecheck do módulo |
| Alto | API, auth, D1/Postgres, Worker, Pages, migration, tracking, integração | domínio + integração, staging, smoke de rota/UI e rollback documentado |
| Crítico | escrita em produção, permissões, pagamento, agenda, segredo, sessão, dado sensível | tudo de Alto, backup/checkpoint, janela para efeito externo, validação explícita e evidência pós-mudança |

Testes não criam booking, cobrança, campanha, mensagem ou dado real sem janela aprovada e alvo seguro.

## 7. Gate obrigatório antes de produção

Nenhuma mudança de produção ocorre enquanto faltar:

1. PR mergeado ou release aprovado conforme o fluxo da superfície;
2. todos os checks obrigatórios verdes;
3. staging publicado e validado para risco alto/crítico;
4. migration aplicada e verificada em staging, quando existir;
5. versão atual e rollback registrados;
6. flag/grant não liberados mantidos desativados, salvo coorte aprovada;
7. validação pré-produção explícita no PR, release ou evidência operacional;
8. plano de smoke pós-mudança e responsável.

A validação explícita registra data/hora, alvo, versão, evidências, resultado, risco remanescente e decisão de prosseguir. Sem isso, só diagnóstico ou validação read-only são autorizados.

## 8. Obrigações de agentes Codex

Antes de editar, o agente lê `AGENTS.md`, esta política, `CODEX_CONTEXT.md`, `TASKS.md`, `DECISIONS.md` e Git status.

No plano de trabalho, declara objetivo único, superfícies, risco, flag/coorte, migration/expand-contract e validações/rollback — ou justifica a não aplicabilidade.

Antes de concluir, informa o que foi validado, o que não foi validado e por quê. Não alega produção pronta com base apenas em testes locais, merge ou healthcheck.

## 9. Evidência mínima

A evidência fica no PR, workflow, release ou diretório privado do operador; nunca inclui segredos.

- Branch/PR: link, SHA e escopo.
- Deploy: workflow/run, versão/deployment e ambiente.
- Migration: banco, versão, backup/checkpoint e verificação.
- Flag/coorte: nome, default, escopo e quantidade agregada de grants quando sensível.
- Rollback: versão de retorno, gatilho e smoke.
- Produção: smoke final e riscos remanescentes.

