# Prompt inicial para novas threads no Codex App

Quando você abrir uma nova thread apontando para o projeto compartilhado
`C:\CodexShared\Projetos\skincos`, use a mensagem abaixo como primeira
mensagem para reduzir ruído e fazer o agente cair no fluxo certo.

## Mensagem base

```text
Use este projeto compartilhado em `C:\CodexShared\Projetos\skincos` apenas como base de contexto e coordenação.
Antes de editar qualquer arquivo:
1. Leia `AGENTS.md` e `docs/decisions/codex-autonomy-policy.md`, carregue o snapshot operacional canônico quando existir e inspecione o Git. Somente em missão raiz ou snapshot ausente/desatualizado, reconstrua o contexto e estado remoto necessários; use `CODEX_CONTEXT.md`, `TASKS.md` e `DECISIONS.md` como histórico durável, não como cópias obrigatórias de estado volátil.
2. Verifique o estado compartilhado com `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\show-shared-codex-status.ps1`.
3. O hook `UserPromptSubmit` encaminha a primeira mensagem ao resolver com intenção `edit`. Não deduza `preview` ou `qualify` pelas palavras do texto: use as ações explícitas para essas intenções.
4. Se o resultado for `ready`, continue na worktree atual. Se for `replace` com `currentThreadAction=create_replacement_thread`, não escreva no checkout atual: confirme o projeto salvo pelo caminho exato, crie uma task substituta no ambiente nativo `worktree`, espere `ready`, navegue para ela e só então arquive a original. `handoff_thread` só pode ser usado para outra task já identificada; a task chamadora não troca o próprio cwd por PowerShell nem faz handoff de si mesma.
5. Se o resultado for `manual_registration_required`, abra/registre o projeto canônico indicado. `ambiguous` e `blocked` são estados fail-closed; não escolha outra worktree por heurística.
6. Uma substituta criada pelo App deve começar pelo marcador privado emitido pelo hook. O marcador é consumido apenas no worktree gerenciado, detached e no SHA esperado; nunca copie o marcador entre tasks. Depois de `ready`, valide a identidade com `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-skincos-worktree.ps1 -ProjectRoot (Get-Location).Path -TaskSlug <task-slug> -Mode edit` e trate o clone compartilhado como somente leitura para contexto.
7. Mantenha autenticação, perfis e overrides fora do repositório compartilhado, em `%LOCALAPPDATA%\Codex\skincos\`; logs e artefatos persistentes ficam em `C:\CodexRuntime\operator\admin\skincos\`.
8. Preserve alterações não relacionadas já existentes no projeto compartilhado ou em worktrees de outros usuários. Worktrees sujas, detached, com PR, manifesto, processo ou lease nunca são removidas fisicamente.
9. Execute contexto, testes, builds e scripts de projeto pelo gateway WSL tipado: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path -NpmScript codex:context`. Não use `wsl.exe -> bash -lc` nem npm de projeto diretamente no Windows.
10. Antes de concluir, valide proporcionalmente ao efeito, registre snapshot/evidência gerada quando fatos materiais mudarem e não duplique estado volátil em `CODEX_CONTEXT.md`, `TASKS.md` ou `DECISIONS.md`.
11. A missão explícita atual, interpretada pela política de autonomia, mantém sua autorização após compactação, CI, merge e retomada. Não peça novamente autorização já concedida; diferencie autorização de gates técnicos, permissões reais, rollout e rollback.

Tarefa desta thread: <descreva aqui a tarefa>
```

## Gerar automaticamente

Se preferir gerar a mensagem já com o `task-slug` e a descrição:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\print-codex-thread-bootstrap.ps1 `
  -TaskSlug corrigir-site-ef `
  -TaskBrief "Investigar e corrigir o fluxo do Site EF sem trabalhar direto no clone compartilhado."
```

## Quando usar

- Sempre que a thread for aberta a partir do clone compartilhado.
- Principalmente quando a tarefa puder virar edição de código, deploy, QA ou
  investigação mais longa.
- Em tarefas puramente de leitura, a thread pode ficar no clone compartilhado,
  mas ainda vale usar a mesma mensagem para manter o agente alinhado.

## Roteamento automático de worktree

O hook `UserPromptSubmit` recebe o texto da primeira mensagem via stdin e o
passa ao resolver. Mensagens usuais sempre entram como `edit`; `preview` e
`qualify` continuam ações explícitas. O objetivo pode identificar uma superfície
do catálogo, mas nunca escolhe por semelhança uma worktree existente, abre um
picker ou habilita fallback.

O contrato JSON do resolver contém `state`, `surfaceId`, `currentCheckout`,
`recommendedCheckout`, `candidateType`, `targetCommit`, `nativeAction`,
`currentThreadAction`, `reasonCodes` e `preservationReasons`. Os estados são:

- `ready`: o checkout atual é elegível;
- `replace`: o Codex App deve criar ou fazer handoff para a candidata indicada;
- `manual_registration_required`: o slot canônico precisa ser aberto como projeto no App;
- `ambiguous`: há mais de uma interpretação ou candidata;
- `blocked`: falta evidência segura ou há proteção ativa.

`currentThreadAction=create_replacement_thread` exige criar uma task
substituta; `handoff_other_thread` é apenas uma possibilidade para uma task
distinta já comprovadamente dona de `recommendedCheckout`. O script não recebe
`threadId`, cookies ou segredos, não cria worktrees, não faz merge e não remove
tasks. A camada nativa cria a task substituta e só arquiva a original depois que
a nova estiver pronta. Arquivar é reversível; exclusão permanente de histórico
não faz parte do contrato disponível.

Uma candidata temporária só pode ser associada por `TaskSlug` exato (ou pela
worktree atual já registrada). O texto do objetivo pode resolver a superfície,
mas nunca é usado sozinho para escolher uma worktree existente.

## Ponte global privada

Checkouts históricos e o clone compartilhado podem não conter os hooks de
roteamento já integrados. Nesses casos, a ponte global do operador só é
instalada por `manage-codex-thread-routing-bridge.ps1` a partir de um source
limpo e verificável. Ela aceita apenas o repositório
`jubenitogarcia/skincos`, preserva o hook global `Stop` e carrega uma cópia com
hashes verificados no runtime privado em
`C:\CodexRuntime\operator\admin\skincos\thread-routing-bridge`. Ela nunca
executa `scripts` do clone compartilhado.

Se o checkout já contém `UserPromptSubmit`, `PreToolUse`, resolver, estado e
topologia completos, a ponte global não faz nada: os hooks do projeto continuam
sendo a única fonte da decisão. Se o bundle privado estiver ausente, alterado
ou inválido, a ponte falha fechada e bloqueia escrita naquele checkout.

O candidato nativo tem validade curta e só reage à sua ativação privada; o
marcador de teste não cria vínculo de worktree e é consumido antes de o hook
emitir o nonce normal de substituição. Depois do merge, o bundle estável deve
ser materializado a partir do checkout limpo cujo `HEAD` é exatamente
`origin/main`:

```powershell
# No worktree limpo do PR, antes da prova manual no App.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\manage-codex-thread-routing-bridge.ps1 `
  -Action install-candidate `
  -ProjectRoot (Get-Location).Path `
  -ActivationCheckout "C:\CodexShared\Projetos\skincos" `
  -Apply

# Depois do merge, em checkout limpo e atualizado de main.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\manage-codex-thread-routing-bridge.ps1 `
  -Action activate-stable `
  -ProjectRoot (Get-Location).Path `
  -Apply
```

`status` é somente leitura; `deactivate` remove apenas os dois handlers da
ponte e preserva os demais hooks globais. Como a definição em
`C:\Users\admin\.codex\hooks.json` muda ao instalar a ponte, abra `/hooks`
no Codex App, revise a definição final e conclua a revisão de confiança antes
do teste. Uma definição nova ou alterada é ignorada pelo App até essa revisão;
isso é um controle intencional, não um fallback a ser contornado.
[A documentação oficial de hooks](https://learn.chatgpt.com/docs/hooks)
descreve esse vínculo de confiança por hash da definição.

## Configuração única do App

Em **Settings > Worktrees**, configure o root gerenciado como:

```text
C:\CodexShared\Worktrees\skincos\admin\managed
```

Crie cinco projetos locais separados no Codex App e mantenha cada pasta abaixo
como a pasta primária do respectivo projeto. Não os adicione como pastas
secundárias de um único projeto, pois é a pasta primária que o App usa nas
operações Git:

```text
C:\CodexShared\Worktrees\skincos\admin\canonical\crm\users
C:\CodexShared\Worktrees\skincos\admin\canonical\crm\atendimento
C:\CodexShared\Worktrees\skincos\admin\canonical\crm\clientes
C:\CodexShared\Worktrees\skincos\admin\canonical\orb\livia
C:\CodexShared\Worktrees\skincos\admin\canonical\orb\meta-ads-publish
```

Depois de confirmar cada projeto no App, registre a confirmação privada do
caminho canônico no runtime do operador. Esse registro não contém IDs de task,
cookies ou segredos e não substitui o cadastro real no App:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\codex-thread-routing-state.ps1 `
  -Action register-native-project `
  -NativeProjectPath "C:\CodexShared\Worktrees\skincos\admin\canonical\crm\users"
```
