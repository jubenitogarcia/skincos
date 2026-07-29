import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const server = spawn('npm', ['--prefix', 'crm/console', 'run', 'storybook'], {
  detached: process.platform !== 'win32',
  stdio: 'pipe',
})
const url = 'http://127.0.0.1:6006/mcp'

function parseMcpMessage(body) {
  const payload = body
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .at(-1) ?? body.trim()
  return JSON.parse(payload)
}

async function postMcp(payload, sessionId) {
  const headers = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': '2025-03-26',
  }
  if (sessionId) headers['Mcp-Session-Id'] = sessionId
  return fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) }) // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request -- fixed loopback endpoint for the local Storybook process above.
}

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
      response = await postMcp({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'skincos-ui-infrastructure-check', version: '1.0.0' },
          },
      })
      if (response.ok) break
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!response?.ok) throw new Error('STORYBOOK_MCP_NOT_READY')
  const initialized = parseMcpMessage(await response.text())
  if (!initialized.result?.serverInfo) throw new Error('STORYBOOK_MCP_INITIALIZE_INVALID')
  const sessionId = response.headers.get('mcp-session-id')
  if (!sessionId) throw new Error('STORYBOOK_MCP_SESSION_MISSING')

  await postMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)
  const toolsResponse = await postMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, sessionId)
  if (!toolsResponse.ok) throw new Error('STORYBOOK_MCP_TOOLS_LIST_FAILED')
  const tools = parseMcpMessage(await toolsResponse.text()).result?.tools
  if (!Array.isArray(tools)) throw new Error('STORYBOOK_MCP_TOOLS_LIST_INVALID')

  const { stdout: inspectorOutput } = await execFileAsync(process.execPath, [
    'node_modules/@modelcontextprotocol/inspector/cli/build/cli.js',
    '--cli',
    url,
    '--transport',
    'http',
    '--method',
    'tools/list',
  ], { cwd: process.cwd(), timeout: 30_000 })
  if (!inspectorOutput.includes('preview-stories')) {
    throw new Error('STORYBOOK_MCP_INSPECTOR_TOOLS_LIST_INVALID')
  }

  console.log(JSON.stringify({
    endpoint: url,
    initializeStatus: response.status,
    state: 'initialized',
    toolCount: tools.length,
    tools: tools.map(tool => tool.name),
    inspector: 'tools/list confirmed',
  }))
} finally {
  stopServer()
}
