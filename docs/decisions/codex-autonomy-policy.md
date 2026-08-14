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
| 1 | Limites não contornáveis da plataforma, lei e segurança | O que o agente não pode burlar: confiança da plataforma, emissão externa indisponível, segredo/PII exposto, ação destrutiva irreversível sobre dado real e controles externos obrigatórios. |
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
evidência. Autorização não fabrica credenciais emitidas externamente, bypass de
MFA, permissões de plataforma ou acesso a dados que o agente não possui.

Risco técnico e reversibilidade definem o rigor de validação, checkpoint,
rollout e rollback. Eles não exigem nova decisão humana quando a missão já
autorizou a ação. Ações irreversíveis ou destrutivas sobre dados reais continuam
fora do escopo até uma decisão humana específica.

### 3.1 Classificação por emissão e contrato

A classificação depende de quem define a validade do valor e do contrato que o
aceita, não de seu nome, store atual, ausência ou presença de um gerador
versionado.

**INTERNAL GENERATED SECRET** é um bearer opaco interno, webhook secret,
application authentication secret, signing/random secret ou outro segredo cuja
validade seja definida inteiramente por sistemas controlados pelo SKINCOS.
Quando a missão já autoriza a superfície e o Codex tem escrita no armazenamento
canônico, ele deve gerar o valor automaticamente com CSPRNG de ao menos 256
bits de entropia, salvo contrato diferente; gravá-lo diretamente no store
canônico; nunca imprimi-lo ou registrá-lo em repositório, worktree, arquivo,
log, artifact, PR ou conversa; validar somente existência/metadados e
comportamento autenticado; e continuar a missão sem nova autorização humana.

“Absence of a versioned generator alone is not evidence that an internal generated secret requires human intervention.”

**EXTERNALLY ISSUED CREDENTIAL** é OAuth, autenticação GitHub, credencial de
API Cloudflare/provider, Meta access token, certificado/chave privada emitida
externamente, MFA/OTP ou outra credencial cuja emissão dependa de outra
autoridade. O Codex nunca a fabrica: tenta primeiro o mecanismo canônico e
autenticado de emissão, refresh ou rotação. Só a trata como blocker humano
quando MFA/autenticação interativa, permissão realmente ausente ou decisão de
confiança externa não puderem ser concluídos pelas ferramentas disponíveis.

Compatibilidade criptográfica, migração de dados, dual-key, sobreposição e
rollback continuam gates técnicos proporcionais ao efeito. A falta de um desses
gates não reclassifica um segredo interno ausente como exceção humana.

### 3.2 Validação delivery-first

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
interrompe por uma ação humana quando houver prova de uma destas situações. Para
uma `EXTERNALLY ISSUED CREDENTIAL`, a ausência só é exceção após a tentativa
canônica autenticada de emissão ou rotação:

A ausência de um `INTERNAL GENERATED SECRET` que atende às condições da seção
3.1 não é exceção humana.

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

### 6.1 Custódia e fila de entrega

O caminho canônico para custódia GitHub -> mini-PC é o runner confiável
`skincos-native-custody` e o workflow dispatch-only
`.github/workflows/provision-native-global-coordination-custody.yml`. O runner
usa um usuário de serviço sem login e pode chamar somente o helper root que
escreve o arquivo privado de coordenação por stdin, atomicamente e sem emitir o
valor. A ausência de custódia no mini-PC é, portanto, uma recuperação técnica
executável; não é uma espera humana recorrente. Um `INTERNAL GENERATED SECRET`
ausente segue a classificação desta política e é gerado quando a missão e a
escrita no store canônico o permitem. Somente a emissão indisponível de uma
`EXTERNALLY ISSUED CREDENTIAL`, MFA/reautenticação ou confiança de plataforma
fora do alcance continua sendo exceção humana.

Quando a sessão GitHub já autenticada e o acesso root nativo existem, o
bootstrap do runner também é uma ação autônoma: use
`scripts/bootstrap-native-custody-runner.ps1`, que fixa/verifica o digest do
runner, obtém o token efêmero somente quando necessário e o transporta por
stdin em memória através do gateway tipado. O gateway precisa enviar UTF-8 sem
BOM para contratos de tokens opacos; o token não entra em argv do Windows,
arquivo, log ou artefato. O `config.sh` upstream necessariamente o recebe
como argumento local de curta duração durante o registro, sem persistência ou
emissão. O instalador cria previamente apenas o
diretório privado exigido pelo sandbox systemd; a workflow continua sendo a
única escritora do arquivo de custódia.

PRs Codex com o marcador persistente `automerge/enabled` entram na fila oficial
quando a API reporta estado `clean`. A fila pode atualizar a branch sob o lease
`merge:main` e redisparar a autoridade; o workflow oficial ainda revalida
SHA/base/head, closure, checks e fencing imediatamente antes do merge. A fila
não concede bypass nem transforma `concurrency` em autoridade.

O resumo executável e os caminhos de recuperação estão em
[`autonomous-delivery-standard.md`](../operations/autonomous-delivery-standard.md).
