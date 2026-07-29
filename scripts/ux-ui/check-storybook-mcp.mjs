import { spawn } from 'node:child_process'

const server = spawn('npm', ['--prefix', 'crm/console', 'run', 'storybook'], {
  detached: process.platform !== 'win32',
  stdio: 'pipe',
})
const url = 'http://127.0.0.1:6006/mcp'

function stopServer() {
  if (server.killed) return
  if (process.platform !== 'win32' && server.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM')
      return
    } catch {}
  }
  server.kill('SIGTERM')
}

try {
  const deadline = Date.now() + 90_000
  let response
  while (Date.now() < deadline) {
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'skincos-ui-infrastructure-check', version: '1.0.0' },
          },
        }),
      })
      if (response.ok) break
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!response?.ok) throw new Error('STORYBOOK_MCP_NOT_READY')
  console.log(JSON.stringify({ endpoint: url, status: response.status, state: 'reachable' }))
} finally {
  stopServer()
}
