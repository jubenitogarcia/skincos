param(
    [string]$TaskBrief = "Descreva aqui a tarefa",
    [string]$TaskSlug = "definir-task-slug",
    [switch]$Interactive,
    [switch]$Json
)

if ($Interactive) {
    $promptedTaskSlug = Read-Host "TaskSlug"
    if (-not [string]::IsNullOrWhiteSpace($promptedTaskSlug)) {
        $TaskSlug = $promptedTaskSlug
    }

    $promptedTaskBrief = Read-Host "TaskBrief"
    if (-not [string]::IsNullOrWhiteSpace($promptedTaskBrief)) {
        $TaskBrief = $promptedTaskBrief
    }
}

$taskBriefLiteral = ([string]$TaskBrief).Replace("'", "''")
$taskSlugLiteral = ([string]$TaskSlug).Replace("'", "''")

$lines = @(
    "Use este projeto compartilhado em ``C:\CodexShared\Projetos\skincos`` apenas como base de contexto e coordenação.",
    "Antes de editar qualquer arquivo:",
    "1. Leia ``AGENTS.md`` e ``docs/decisions/codex-autonomy-policy.md``, carregue o snapshot operacional canônico quando existir e inspecione o Git. Somente em missão raiz ou snapshot ausente/desatualizado, reconstrua o contexto e estado remoto necessários; use ``CODEX_CONTEXT.md``, ``TASKS.md`` e ``DECISIONS.md`` como histórico durável, não como cópias obrigatórias de estado volátil.",
    "2. Verifique o estado compartilhado com ``powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\show-shared-codex-status.ps1``.",
    "3. Antes de editar, resolva a superfície e a worktree com ``powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\resolve-codex-thread-worktree.ps1 -ProjectRoot (Get-Location).Path -TaskBrief '$taskBriefLiteral' -TaskSlug '$taskSlugLiteral' -Intent edit``.",
    "4. Se o resultado for ``ready``, continue somente na worktree atual. Se for ``replace`` com ``nativeAction=create_thread``, crie uma thread substituta usando o ambiente nativo ``worktree`` do Codex App; se for ``handoff_thread``, use handoff somente para outra thread. Não tente trocar o cwd da thread chamadora por PowerShell.",
    "5. Se o resultado for ``manual_registration_required``, abra/registre o projeto canônico indicado antes de continuar. Estados ``ambiguous`` e ``blocked`` são fail-closed; não escolha outra worktree por heurística.",
    "6. Depois de selecionar ou criar a worktree, valide a identidade com ``powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-skincos-worktree.ps1 -ProjectRoot (Get-Location).Path -TaskSlug '$taskSlugLiteral' -Mode edit``; trabalhe apenas nela e trate o clone compartilhado como somente leitura para contexto.",
    "7. Mantenha autenticação, perfis e overrides fora do repositório compartilhado, em ``%LOCALAPPDATA%\Codex\skincos\``; logs e artefatos persistentes ficam em ``C:\CodexRuntime\operator\admin\skincos\``.",
    "8. Preserve alterações não relacionadas já existentes no projeto compartilhado ou em worktrees de outros usuários. Worktrees sujas, detached, com PR, manifesto, processo ou lease nunca são removidas ou substituídas fisicamente.",
    "9. Execute contexto, testes, builds e scripts de projeto pelo gateway WSL tipado: ``powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path -NpmScript codex:context``. Não use ``wsl.exe -> bash -lc`` nem npm de projeto diretamente no Windows.",
    "10. Antes de concluir, valide proporcionalmente ao efeito, registre snapshot/evidência gerada quando fatos materiais mudarem e não duplique estado volátil em ``CODEX_CONTEXT.md``, ``TASKS.md`` ou ``DECISIONS.md``.",
    "11. A missão explícita atual, interpretada pela política de autonomia, mantém sua autorização após compactação, CI, merge e retomada. Não peça novamente autorização já concedida; diferencie autorização de gates técnicos, permissões reais, rollout e rollback.",
    "",
    "Tarefa desta thread: $TaskBrief"
)

$prompt = ($lines -join [Environment]::NewLine)

if ($Json) {
    [pscustomobject]@{
        taskBrief = $TaskBrief
        taskSlug = $TaskSlug
        prompt = $prompt
    } | ConvertTo-Json -Depth 3
}
else {
    $prompt
}
