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

$lines = @(
    "Use este projeto compartilhado em `C:\CodexShared\Projetos\skincos` apenas como base de contexto e coordenação.",
    "Antes de editar qualquer arquivo:",
    "1. Leia `AGENTS.md`, `CODEX_CONTEXT.md`, `TASKS.md` e `DECISIONS.md`.",
    "2. Verifique o estado compartilhado com `powershell -ExecutionPolicy Bypass -File .\scripts\show-shared-codex-status.ps1`.",
    "3. Se a tarefa não for estritamente de leitura, crie um worktree dedicado com `powershell -ExecutionPolicy Bypass -File .\scripts\new-shared-worktree.ps1 -TaskSlug $TaskSlug -Fetch`.",
    "4. Depois de criar o worktree, trabalhe apenas nele e trate o clone compartilhado como somente leitura para contexto.",
    "5. Mantenha estado local, logs, perfis e overrides fora do repositório compartilhado, em `%LOCALAPPDATA%\Codex\skincos\`.",
    "6. Preserve alterações não relacionadas já existentes no projeto compartilhado ou em worktrees de outros usuários.",
    "7. Antes de concluir, valide o que mudar e registre contexto relevante em `CODEX_CONTEXT.md`, `TASKS.md` e `DECISIONS.md` quando fizer sentido.",
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
