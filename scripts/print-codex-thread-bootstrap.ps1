param(
    [string]$TaskBrief = "Describe the task here",
    [string]$TaskSlug = "define-task-slug",
    [string]$Actor = $env:USERNAME,
    [string[]]$ValidationCommands = @(
        "npm run codex:context",
        "<add task-specific validation commands before finishing>"
    ),
    [switch]$Interactive,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

function Normalize-Value {
    param([string]$Value)
    return ($Value.Trim().ToLowerInvariant() -replace '[^a-z0-9._-]', '-')
}

function Normalize-ValidationCommands {
    param([string[]]$Values)

    $normalized = @()
    foreach ($value in $Values) {
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        foreach ($part in ($value -split '[;,]')) {
            $trimmed = $part.Trim()
            if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
                $normalized += $trimmed
            }
        }
    }

    return $normalized
}

if ($Interactive) {
    $promptedTaskSlug = Read-Host "TaskSlug"
    if (-not [string]::IsNullOrWhiteSpace($promptedTaskSlug)) {
        $TaskSlug = $promptedTaskSlug
    }

    $promptedTaskBrief = Read-Host "TaskBrief"
    if (-not [string]::IsNullOrWhiteSpace($promptedTaskBrief)) {
        $TaskBrief = $promptedTaskBrief
    }

    $promptedValidation = Read-Host "ValidationCommands (semicolon separated, optional)"
    if (-not [string]::IsNullOrWhiteSpace($promptedValidation)) {
        $ValidationCommands = @(
            $promptedValidation.Split(';') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
        )
    }
}

$normalizedActor = Normalize-Value -Value $Actor
$normalizedTask = Normalize-Value -Value $TaskSlug
$expectedBranch = "codex/$normalizedActor/$normalizedTask"
$expectedWorktree = "C:\CodexShared\Worktrees\skincos\$normalizedActor\$normalizedTask"
$validationLines = @(Normalize-ValidationCommands -Values $ValidationCommands)

if ($validationLines.Count -eq 0) {
    $validationLines = @("<add task-specific validation commands before finishing>")
}

$lines = @(
    "Use this shared project in `C:\CodexShared\Projetos\skincos` only as a context and coordination base.",
    "Before editing any file:",
    "1. Read `AGENTS.md`, `CODEX_CONTEXT.md`, `TASKS.md`, and `DECISIONS.md`.",
    "2. Check the shared state with `powershell -ExecutionPolicy Bypass -File .\scripts\show-shared-codex-status.ps1`.",
    "3. If the task is not strictly read-only, create a dedicated worktree with `powershell -ExecutionPolicy Bypass -File .\scripts\new-shared-worktree.ps1 -TaskSlug $normalizedTask -Fetch`.",
    "4. After creating the worktree, work only there and treat the shared clone as read-only context.",
    "5. Keep local state, logs, profiles, and overrides outside the shared repo in `%LOCALAPPDATA%\Codex\skincos\`.",
    "6. Each operator uses their own Codex/OpenAI account. Do not assume visibility into other operators' private Codex threads.",
    "7. Use `CODEX_CONTEXT.md`, `TASKS.md`, and `DECISIONS.md` as the handoff contract between operators.",
    "8. Before finishing, validate the change and update the continuity files when the task changes current state, next steps, or operational decisions.",
    "",
    "Task slug: $normalizedTask",
    "Expected branch: $expectedBranch",
    "Expected worktree: $expectedWorktree",
    "",
    "Expected validation commands:"
)

foreach ($command in $validationLines) {
    $lines += "- $command"
}

$lines += ""
$lines += "Task for this thread: $TaskBrief"

$prompt = ($lines -join [Environment]::NewLine)

if ($Json) {
    [pscustomobject]@{
        actor = $normalizedActor
        taskBrief = $TaskBrief
        taskSlug = $normalizedTask
        expectedBranch = $expectedBranch
        expectedWorktree = $expectedWorktree
        validationCommands = $validationLines
        prompt = $prompt
    } | ConvertTo-Json -Depth 5
}
else {
    $prompt
}
