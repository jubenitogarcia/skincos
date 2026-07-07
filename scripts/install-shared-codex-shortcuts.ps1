param(
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string]$StartMenuRoot = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Skincos Codex",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

function Ensure-Directory {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        try {
            New-Item -ItemType Directory -Path $Path -Force | Out-Null
        }
        catch [System.UnauthorizedAccessException] {
            throw "Access denied while creating '$Path'. Re-run this installer from an elevated PowerShell session to publish shared Start Menu shortcuts for all local users."
        }
    }
}

function Remove-DirectoryIfExists {
    param([string]$Path)

    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
}

function New-ShortcutFile {
    param(
        [string]$ShortcutPath,
        [string]$TargetPath,
        [string]$Arguments,
        [string]$WorkingDirectory,
        [string]$Description
    )

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $TargetPath
    $shortcut.Arguments = $Arguments
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.Description = $Description
    $shortcut.IconLocation = "$TargetPath,0"
    $shortcut.Save()
}

if ($Uninstall) {
    Remove-DirectoryIfExists -Path $StartMenuRoot
    [pscustomobject]@{
        action = "uninstall"
        startMenuRoot = $StartMenuRoot
        removed = $true
    } | ConvertTo-Json -Depth 3
    exit 0
}

$runner = Join-Path $ProjectRoot "scripts\run-shared-codex-shortcut.ps1"
$powershellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

$shortcuts = @(
    @{ Group = "Setup"; Name = "Shared Setup"; Action = "SharedSetup"; Description = "Bootstrap do workspace compartilhado do Skincos." },
    @{ Group = "Setup"; Name = "Shared Validate"; Action = "SharedValidate"; Description = "Validação do workspace compartilhado do Skincos." },
    @{ Group = "Setup"; Name = "Runtime Setup"; Action = "RuntimeSetup"; Description = "Bootstrap do runtime compartilhado do orb/n8n." },
    @{ Group = "Setup"; Name = "Runtime Validate"; Action = "RuntimeValidate"; Description = "Validação do runtime compartilhado do orb/n8n." },
    @{ Group = "Setup"; Name = "WSL Account Bootstrap"; Action = "WslAccountBootstrap"; Description = "Bootstrap da conta WSL para o runtime compartilhado." },
    @{ Group = "Contexto"; Name = "Shared Status"; Action = "SharedStatus"; Description = "Status rápido do clone compartilhado e das worktrees." },
    @{ Group = "Contexto"; Name = "Codex Context"; Action = "CodexContext"; Description = "Contexto seguro do projeto para sessões no Codex." },
    @{ Group = "Contexto"; Name = "Thread Bootstrap"; Action = "ThreadBootstrap"; Description = "Prompt base para novas threads do Codex App." },
    @{ Group = "Contexto"; Name = "New Worktree"; Action = "NewWorktree"; Description = "Cria um worktree compartilhado para uma nova tarefa." },
    @{ Group = "Local"; Name = "Website Local Start"; Action = "WebsiteLocalStart"; Description = "Sobe o website local usando o estado privado do operador." },
    @{ Group = "Local"; Name = "Website Local Stop"; Action = "WebsiteLocalStop"; Description = "Encerra o website local rastreado no estado privado do operador." },
    @{ Group = "Local"; Name = "CRM Local"; Action = "CrmLocal"; Description = "Sobe o CRM local com o estado privado do operador." },
    @{ Group = "Local"; Name = "CRM Site EF"; Action = "CrmSiteEf"; Description = "Sobe o CRM local focado no módulo Site EF." },
    @{ Group = "Local"; Name = "CRM Meta Ads"; Action = "CrmMetaAds"; Description = "Sobe o CRM local focado no módulo Meta Ads." },
    @{ Group = "Local"; Name = "CRM Atendimento Clínica"; Action = "CrmAtendimentoClinica"; Description = "Sobe o módulo local de Atendimento Clínica." },
    @{ Group = "Local"; Name = "CRM Local Stop"; Action = "CrmLocalStop"; Description = "Encerra os launchers locais de CRM rastreados no estado privado do operador." },
    @{ Group = "Runtime"; Name = "Orb Status"; Action = "OrbStatus"; Description = "Mostra o status do stack live do orb/n8n." },
    @{ Group = "Runtime"; Name = "Orb Restart"; Action = "OrbRestart"; Description = "Reinicia o stack live do orb/n8n." },
    @{ Group = "Runtime"; Name = "Orb Repair"; Action = "OrbRepair"; Description = "Reconcilia o contrato Postgres do runtime live e valida o stack." },
    @{ Group = "Runtime"; Name = "Orb Logs"; Action = "OrbLogs"; Description = "Mostra os logs recentes do stack live do orb/n8n." },
    @{ Group = "Runtime"; Name = "Orb Validate"; Action = "OrbValidate"; Description = "Valida o runtime live do orb/n8n." },
    @{ Group = "Runtime"; Name = "Orb Audit"; Action = "OrbAudit"; Description = "Audita os units skincos-* instalados no mini-PC." }
)

Ensure-Directory -Path $StartMenuRoot

$installed = @()
foreach ($shortcutSpec in $shortcuts) {
    $groupPath = Join-Path $StartMenuRoot $shortcutSpec.Group
    Ensure-Directory -Path $groupPath

    $shortcutPath = Join-Path $groupPath ($shortcutSpec.Name + ".lnk")
    $arguments = '-NoExit -ExecutionPolicy Bypass -File "{0}" -Action {1} -ProjectRoot "{2}"' -f $runner, $shortcutSpec.Action, $ProjectRoot
    New-ShortcutFile -ShortcutPath $shortcutPath -TargetPath $powershellExe -Arguments $arguments -WorkingDirectory $ProjectRoot -Description $shortcutSpec.Description

    $installed += [pscustomobject]@{
        group = $shortcutSpec.Group
        name = $shortcutSpec.Name
        action = $shortcutSpec.Action
        path = $shortcutPath
    }
}

[pscustomobject]@{
    action = "install"
    startMenuRoot = $StartMenuRoot
    installed = $installed
} | ConvertTo-Json -Depth 4
