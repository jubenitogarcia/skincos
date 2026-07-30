import { spawnSync } from 'node:child_process'

function windowsPath(value) {
  const raw = String(value || '')
  const match = raw.match(/^\/mnt\/([a-z])(?:\/(.*))?$/i)
  if (!match) return raw
  return `${match[1].toUpperCase()}:\\${String(match[2] || '').replaceAll('/', '\\')}`
}

function validateEntry(entry, currentSid, label) {
  if (!entry || entry.ownerSid !== currentSid || entry.protected !== true) {
    throw new Error(`${label} deve pertencer ao operador atual e ter herança DACL desativada.`)
  }
  const rules = Array.isArray(entry.rules) ? entry.rules : []
  if (!rules.length) throw new Error(`${label} não possui regra DACL explícita para o operador atual.`)
  for (const rule of rules) {
    if (rule.inherited === true || rule.type !== 'Allow' || rule.identitySid !== currentSid) {
      throw new Error(`${label} concede acesso fora do operador atual ou contém regra herdada.`)
    }
  }
  if (!rules.some((rule) => String(rule.rights || '').split(',').map((item) => item.trim()).includes('FullControl'))) {
    throw new Error(`${label} deve conceder FullControl explícito somente ao operador atual.`)
  }
}

export function validateWindowsAclReport(report, label = 'arquivo privado') {
  const currentSid = String(report?.currentSid || '').trim()
  if (!/^S-\d(?:-\d+)+$/i.test(currentSid)) throw new Error('Não foi possível identificar o SID do operador Windows atual.')
  validateEntry(report?.file, currentSid, label)
  validateEntry(report?.parent, currentSid, `O diretório de ${label}`)
  return true
}

export function inspectWindowsPrivateAcl(file, label = 'arquivo privado') {
  const encodedTarget = Buffer.from(windowsPath(file), 'utf16le').toString('base64')
  const command = String.raw`
$ErrorActionPreference = 'Stop'
$targetInput = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${encodedTarget}'))
$target = (Resolve-Path -LiteralPath $targetInput).Path
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Read-AclEntry([string] $path) {
  $acl = Get-Acl -LiteralPath $path
  $ownerSid = ([System.Security.Principal.NTAccount]::new($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
    @{
      identitySid = $_.IdentityReference.Value
      type = $_.AccessControlType.ToString()
      inherited = [bool]$_.IsInherited
      rights = $_.FileSystemRights.ToString()
    }
  })
  @{
    ownerSid = $ownerSid
    protected = [bool]$acl.AreAccessRulesProtected
    rules = $rules
  }
}
@{
  currentSid = $currentSid
  file = Read-AclEntry $target
  parent = Read-AclEntry (Split-Path -Parent $target)
} | ConvertTo-Json -Depth 6 -Compress
`
  const result = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  })
  if (result.status !== 0 || !String(result.stdout || '').trim()) {
    throw new Error(`${label} não pôde ter proprietário e DACL verificados no Windows.`)
  }
  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    throw new Error(`${label} retornou uma inspeção DACL inválida.`)
  }
  validateWindowsAclReport(report, label)
  return 'windows-owner-dacl'
}
