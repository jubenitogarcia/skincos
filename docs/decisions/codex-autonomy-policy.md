# Política de autonomia persistente do Codex

**Status:** obrigatória
**Aplica-se a:** missões explícitas do Codex no SKINCOS, inclusive compactação,
retomada, supervisor, worktrees, CI, PRs, promoção e rollback.  
**Fonte canônica para autorização:** esta política interpreta e preserva a
autorização da missão atual. Ela não substitui controles da plataforma nem os
gates técnicos de cada domínio.

## 1. Princípio

A missão explícita atual do usuário é uma autorização persistente para executar
o objetivo dentro do escopo que ela declara. Ela continua válida após
compactação, continuação automática, mudança de worktree, correção de CI,
commit, merge e recarga de contexto. O agente não pede novamente uma
autorização já concedida nem converte uma pendência técnica em pergunta de
permissão.

Uma continuação gerada pelo supervisor transporta a missão e sua autorização;
ela não cria nem amplia escopo. Um novo pedido do usuário é necessário somente
para iniciar objetivo diferente, ampliar materialmente o domínio ou resolver uma
exceção humana definida pela missão.

## 2. Hierarquia por função

As fontes abaixo não disputam a mesma decisão. Não se aplica uma regra genérica
de “a instrução mais restritiva sempre vence”; cada fonte responde a uma
pergunta diferente.

| Ordem | Fonte | Decide |
| --- | --- | --- |
| 1 | Limites não contornáveis da plataforma, lei e segurança | O que o agente não pode burlar: confiança da plataforma, credenciais inexistentes, segredo/PII exposto, ação destrutiva irreversível sobre dado real e controles externos obrigatórios. |
| 2 | Missão explícita atual do usuário | Objetivo, superfícies, ações autorizadas, exceções humanas e critério de conclusão. |
| 3 | Esta política | Como a autorização da missão é persistida, transportada e distinguida de gates técnicos. |
| 4 | Políticas de domínio, runbooks e contratos de release | Elegibilidade técnica: flags, grants, migrations, rollout, testes, evidência, rollback e validação por ambiente. |
| 5 | Estado gerado, snapshot de sessão, checkpoint e evidência | Estado observado, inputs, hashes, blockers e provas reutilizáveis; não criam nem revogam autorização. |
| 6 | Documentos históricos e de contexto | Topologia, decisões estáveis e histórico; não substituem a missão nem o estado remoto atual. |

Quando houver conflito, o agente identifica a dimensão: uma missão pode
autorizar produção, por exemplo, enquanto uma política de domínio ainda impede a
promoção por falta de rollback ou de validação pré-produção. Isso é um
**blocker técnico verificável**, não ausência de autorização.

Autorização para executar uma operação não equivale a ownership instantâneo do
recurso global necessário para executá-la. A missão pode continuar autorizada
enquanto aguarda `merge:main`, `release:<module>` ou um lease de superfície; a
falta temporária do lease é espera ou blocker técnico fail-closed, nunca motivo
para pedir autorização duplicada.

## 3. Escopo autorizado e persistência

Quando previstos pela missão, são ações dentro do escopo: criar worktree e
branch; editar código, documentação, políticas, skills, hooks e configuração
local suportada; commits, push, PR, CI e merge; recursos sintéticos; ações em
GitHub e Cloudflare; migrations aditivas; preview, staging, pilot, canary,
produção, smoke, rollback e cleanup.

Autorização para segredos permite somente sua criação, rotação, referência ou
uso por canais e armazenamentos aprovados. Valores de segredo, tokens, cookies,
chaves privadas e PII nunca são exibidos, versionados ou incluídos em
evidência. Autorização também não cria credenciais, bypass de MFA, permissões
de plataforma ou acesso a dados que o agente não possui.

Risco técnico e reversibilidade definem o rigor de validação, checkpoint,
rollout e rollback. Eles não exigem nova decisão humana quando a missão já
autorizou a ação. Ações irreversíveis ou destrutivas sobre dados reais continuam
fora do escopo até uma decisão humana específica.

### 3.1 Validação delivery-first

O classificador versionado em `ops/codex/risk-policy.json` usa efeito, não o
nome da ferramenta, para escolher o gate:

- `low`: documentação e conteúdo estático; diff e parse estático bastam.
- `medium` (`normal`): código comum e alterações do próprio operador; no máximo
  um teste/build focal ou uma jornada funcional curta.
- `high` (`elevated`): auth, permissões, pagamentos, segredos, migrations,
  workflows, Workers, Cloudflare e integrações; exige foco e rollback, sem
  staging, suíte integral ou scan profundo por ritual.
- `critical` (`exceptional`): somente caminhos explicitamente irreversíveis,
  destrutivos, de dado real/financeiro ou de exposição de credencial; a execução
  para no gate excepcional até haver decisão específica.

Workflow, Worker, segredo, migration, GitHub, Cloudflare ou MCP não são críticos
automaticamente. O gate agregado `codex-autonomy-gate` é o único check obrigatório
da branch; os demais workflows usam filtros de caminho e só rodam quando o
domínio alterado é relevante.

## 4. Exceções humanas

Para uma missão que adota a autorização persistente desta política, o agente só
interrompe por uma ação humana quando houver prova de uma destas situações:

1. MFA ou reautenticação interativa que nenhuma ferramenta disponível conclui;
2. permissão realmente ausente e não provisionável pelo Codex;
3. compra, contratação ou alteração de faturamento;
4. decisão médica, jurídica, trabalhista ou comercial;
5. alteração irreversível ou destrutiva sobre dados reais;
6. ampliação para produto ou domínio não relacionado.

O bloqueio informa uma única ação humana mínima, específica e executável. Falta
de um check, flag, grant, evidência, versão de rollback ou pré-produção não é
exceção humana: deve ser tratado pelo fluxo técnico aplicável.

## 5. Gates de domínio continuam obrigatórios

Esta política não ativa módulos, flags, grants, rotas de escrita ou workflows
por si só. Antes de alterar uma superfície, o agente aplica a política e o
runbook do domínio: usa mudanças aditivas, defaults fail-closed, menor escopo,
rollback identificável, validação proporcional e prova no ambiente correto.

Merge, healthcheck, autorização persistente ou snapshot válido não provam
produção. Da mesma forma, um gate técnico pendente não apaga autorização:
registre a evidência faltante, execute a menor ação segura que a produza e só
prossiga quando o gate estiver satisfeito.

## 6. Aplicação operacional

- AGENTS.md orienta o início da tarefa e aponta esta política.
- A política operacional de mudanças define gates e rollback, sem reinterpretar
  autorização.
- O estado operacional gerado é `ops/codex/current-state.json`, produzido por
  `scripts/codex-current-state.mjs` e ignorado do Git por ser volátil. O
  snapshot privado em `.codex/runtime/` preserva somente a continuidade da
  sessão; nenhum dos dois substitui a missão.
- Bootstrap, Skill e supervisor carregam a missão, o estado gerado e, quando
  aplicável, o snapshot privado sem reler ou duplicar estado por hábito.
- Checkpoints e estado gerado são atualizados somente quando fatos materiais
  mudam; evidências com os mesmos inputs válidos são reutilizadas.
- Relatórios distinguem claramente: autorizado, tecnicamente elegível,
  executado, validado, bloqueado e não comprovado.
