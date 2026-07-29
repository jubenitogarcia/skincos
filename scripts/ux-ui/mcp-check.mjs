import { spawnSync } from 'node:child_process'

const attempts = process.platform === 'win32'
  ? [['codex', ['mcp', 'list']]]
  : [['powershell.exe', ['-NoProfile', '-Command', 'codex mcp list']], ['cmd.exe', ['/d', '/c', 'codex mcp list']]]

for (const [command, args] of attempts) {
  const result = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, TERM: 'xterm-256color' } })
  if (!result.error && result.status === 0) {
    process.stdout.write(result.stdout)
    process.exit(0)
  }
}

console.error('MCP_CHECK_UNAVAILABLE: run `codex mcp list` from the Windows Codex CLI.')
process.exitCode = 1
