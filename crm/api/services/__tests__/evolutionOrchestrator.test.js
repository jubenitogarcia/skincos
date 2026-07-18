import test from 'node:test'
import assert from 'node:assert/strict'
import { evolutionOrchestrator } from '../evolutionOrchestrator.js'

const ORIGINAL_FETCH = global.fetch
const ORIGINAL_ENV = {
  EVOLUTION_API_URL: process.env.EVOLUTION_API_URL,
  EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY,
  EVOLUTION_INSTANCE_PREFIX: process.env.EVOLUTION_INSTANCE_PREFIX,
  EVOLUTION_RETRY_DELAY_MS: process.env.EVOLUTION_RETRY_DELAY_MS
}

function restoreEnv() {
  Object.entries(ORIGINAL_ENV).forEach(([key, value]) => {
    if (value == null) delete process.env[key]
    else process.env[key] = value
  })
}

function mockJsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(body)
    }
  }
}

test.afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  restoreEnv()
})

test('getStatus degrades gracefully when Evolution is offline', async () => {
  process.env.EVOLUTION_API_URL = 'http://127.0.0.1:8080'
  process.env.EVOLUTION_API_KEY = 'test-key'

  global.fetch = async () => {
    throw new TypeError('fetch failed')
  }

  const status = await evolutionOrchestrator.getStatus()
  assert.equal(status.providerOnline, false)
  assert.equal(status.providerError, 'fetch failed')
  assert.equal(status.channels.length, 9)
  assert.equal(status.errorInstances, 9)
  assert.ok(status.channels.every((channel) => channel.status === 'error'))
})

test('getStatus treats disconnected and available-like states as free', async () => {
  process.env.EVOLUTION_API_URL = 'http://evolution.local'
  process.env.EVOLUTION_API_KEY = 'test-key'
  process.env.EVOLUTION_INSTANCE_PREFIX = 'crm-channel-'

  global.fetch = async (url) => {
    if (String(url) === 'http://evolution.local/instance/fetchInstances') {
      return mockJsonResponse([
        { name: 'crm-channel-1', connectionStatus: 'disconnected', profileName: 'Canal 1' },
        { name: 'crm-channel-2', connectionStatus: 'available', profileName: 'Canal 2' },
        { name: 'crm-channel-3', connectionStatus: 'closed', profileName: 'Canal 3' },
        { name: 'crm-channel-4', connectionStatus: 'open', profileName: 'Canal 4' }
      ])
    }
    return mockJsonResponse([])
  }

  const status = await evolutionOrchestrator.getStatus()
  const byChannel = new Map(status.channels.map((item) => [item.channel, item.status]))

  assert.equal(byChannel.get(1), 'free')
  assert.equal(byChannel.get(2), 'free')
  assert.equal(byChannel.get(3), 'free')
  assert.equal(byChannel.get(4), 'connected')
  assert.equal(status.freeInstances, 8)
  assert.equal(status.connectedInstances, 1)
  assert.equal(status.errorInstances, 0)
})

test('startChannel recycles the same closed unpaired Evolution instance before requesting its QR', async () => {
  process.env.EVOLUTION_API_URL = 'http://evolution.local'
  process.env.EVOLUTION_API_KEY = 'test-key'
  process.env.EVOLUTION_INSTANCE_PREFIX = 'crm-channel-'

  const calls = []
  let createAttempts = 0
  global.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method || 'GET' }
    calls.push(request)
    if (request.url.endsWith('/instance/fetchInstances')) {
      return mockJsonResponse([{
        name: 'crm-channel-2',
        connectionStatus: 'connecting',
        number: null,
        ownerJid: null
      }])
    }
    if (request.url.endsWith('/instance/connectionState/crm-channel-2')) {
      return mockJsonResponse({ instance: { state: 'close' } })
    }
    if (request.url.endsWith('/instance/delete/crm-channel-2')) {
      return mockJsonResponse({ status: 'SUCCESS' })
    }
    if (request.url.endsWith('/instance/create')) {
      createAttempts += 1
      if (createAttempts === 1) {
        return mockJsonResponse({ message: 'Forbidden' }, { ok: false, status: 403 })
      }
      return mockJsonResponse({ instance: { instanceName: 'crm-channel-2', status: 'created' } })
    }
    if (request.url.endsWith('/instance/connect/crm-channel-2')) {
      return mockJsonResponse({ base64: 'data:image/png;base64,real-qr', instance: { state: 'connecting' } })
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`)
  }

  const result = await evolutionOrchestrator.startChannel(2)
  const cached = await evolutionOrchestrator.getChannelQR(2)

  assert.equal(result.instance.channel, 2)
  assert.equal(result.qr, 'data:image/png;base64,real-qr')
  assert.equal(cached.qr, result.qr)
  assert.equal(cached.cached, true)
  assert.deepEqual(calls.map((item) => `${item.method} ${item.url}`), [
    'GET http://evolution.local/instance/fetchInstances',
    'GET http://evolution.local/instance/connectionState/crm-channel-2',
    'DELETE http://evolution.local/instance/delete/crm-channel-2',
    'POST http://evolution.local/instance/create',
    'POST http://evolution.local/instance/create',
    'GET http://evolution.local/instance/connect/crm-channel-2'
  ])
})

test('getChannelQR coalesces concurrent provider requests for the same channel', async () => {
  process.env.EVOLUTION_API_URL = 'http://evolution.local'
  process.env.EVOLUTION_API_KEY = 'test-key'
  process.env.EVOLUTION_INSTANCE_PREFIX = 'crm-channel-'

  let connectCalls = 0
  let releaseConnect
  const connectResponse = new Promise((resolve) => {
    releaseConnect = resolve
  })
  global.fetch = async (url) => {
    assert.equal(String(url), 'http://evolution.local/instance/connect/crm-channel-9')
    connectCalls += 1
    return connectResponse
  }

  const first = evolutionOrchestrator.getChannelQR(9)
  const second = evolutionOrchestrator.getChannelQR(9)
  await Promise.resolve()
  assert.equal(connectCalls, 1)

  releaseConnect(mockJsonResponse({
    base64: 'data:image/png;base64,coalesced-qr',
    instance: { state: 'connecting' }
  }))
  const [firstResult, secondResult] = await Promise.all([first, second])

  assert.equal(firstResult.qr, 'data:image/png;base64,coalesced-qr')
  assert.equal(secondResult.qr, firstResult.qr)
  assert.equal(connectCalls, 1)
})

test('fetchChats sends the expected Evolution endpoint and pagination payload', async () => {
  process.env.EVOLUTION_API_URL = 'http://evolution.local'
  process.env.EVOLUTION_API_KEY = 'test-key'
  process.env.EVOLUTION_INSTANCE_PREFIX = 'crm-channel-'

  let capturedUrl = ''
  let capturedInit = null
  global.fetch = async (url, init) => {
    capturedUrl = String(url)
    capturedInit = init
    return mockJsonResponse({ records: [] })
  }

  await evolutionOrchestrator.fetchChats(3, { limit: 25, offset: 50 })

  assert.equal(capturedUrl, 'http://evolution.local/chat/findChats/crm-channel-3')
  assert.equal(capturedInit.method, 'POST')
  assert.equal(capturedInit.headers.get('apikey'), 'test-key')
  assert.deepEqual(JSON.parse(capturedInit.body), { take: 25, skip: 50, where: { archived: false } })
})

test('fetchChats sends archived=true filter when archivedOnly is requested', async () => {
  process.env.EVOLUTION_API_URL = 'http://evolution.local'
  process.env.EVOLUTION_API_KEY = 'test-key'
  process.env.EVOLUTION_INSTANCE_PREFIX = 'crm-channel-'

  let capturedBody = null
  global.fetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body)
    return mockJsonResponse({ records: [] })
  }

  await evolutionOrchestrator.fetchChats(4, { limit: 10, offset: 20, archivedOnly: true })

  assert.deepEqual(capturedBody, { take: 10, skip: 20, where: { archived: true } })
})

test('fetchContacts sends the expected Evolution endpoint and pagination payload', async () => {
  process.env.EVOLUTION_API_URL = 'http://evolution.local'
  process.env.EVOLUTION_API_KEY = 'test-key'
  process.env.EVOLUTION_INSTANCE_PREFIX = 'crm-channel-'

  let capturedUrl = ''
  let capturedInit = null
  global.fetch = async (url, init) => {
    capturedUrl = String(url)
    capturedInit = init
    return mockJsonResponse([{ remoteJid: '5511999998888@s.whatsapp.net', pushName: 'Contato' }])
  }

  await evolutionOrchestrator.fetchContacts(2, { limit: 120, page: 3 })

  assert.equal(capturedUrl, 'http://evolution.local/chat/findContacts/crm-channel-2')
  assert.equal(capturedInit.method, 'POST')
  assert.equal(capturedInit.headers.get('apikey'), 'test-key')
  assert.deepEqual(JSON.parse(capturedInit.body), {
    where: {},
    offset: 120,
    page: 3
  })
})

test('fetchMessages normalizes remoteJid and sends the correct query payload', async () => {
  process.env.EVOLUTION_API_URL = 'http://evolution.local'

  let capturedBody = null
  global.fetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body)
    return mockJsonResponse({ messages: { records: [] } })
  }

  await evolutionOrchestrator.fetchMessages(2, '5511999998888', { limit: 80, page: 4 })

  assert.deepEqual(capturedBody, {
    where: {
      key: {
        remoteJid: '5511999998888@s.whatsapp.net'
      }
    },
    offset: 80,
    page: 4
  })
})

test('sendText uses /message/sendText with number and quoted reply metadata', async () => {
  process.env.EVOLUTION_API_URL = 'http://evolution.local'

  let capturedUrl = ''
  let capturedBody = null
  global.fetch = async (url, init) => {
    capturedUrl = String(url)
    capturedBody = JSON.parse(init.body)
    return mockJsonResponse({ key: { id: 'mid-1' } })
  }

  await evolutionOrchestrator.sendText(1, '5511999998888@s.whatsapp.net', 'Oi', {
    replyToMessageId: 'ABCD1234',
    replyToPreview: 'Mensagem original'
  })

  assert.equal(capturedUrl, 'http://evolution.local/message/sendText/crm-channel-1')
  assert.deepEqual(capturedBody, {
    number: '5511999998888',
    text: 'Oi',
    quoted: {
      key: {
        id: 'ABCD1234',
        remoteJid: '5511999998888@s.whatsapp.net',
        fromMe: false
      },
      message: {
        conversation: 'Mensagem original'
      }
    }
  })
})

test('archiveChat uses /chat/archiveChat with normalized remoteJid and archive flag', async () => {
  process.env.EVOLUTION_API_URL = 'http://evolution.local'

  let capturedUrl = ''
  let capturedBody = null
  global.fetch = async (url, init) => {
    capturedUrl = String(url)
    capturedBody = JSON.parse(init.body)
    return mockJsonResponse({ archived: true })
  }

  await evolutionOrchestrator.archiveChat(2, '5511999998888', true)

  assert.equal(capturedUrl, 'http://evolution.local/chat/archiveChat/crm-channel-2')
  assert.deepEqual(capturedBody, {
    chat: '5511999998888@s.whatsapp.net',
    archive: true
  })
})

test('markMessagesAsRead sends readMessages with normalized keys to the correct endpoint', async () => {
  process.env.EVOLUTION_API_URL = 'http://evolution.local'

  let capturedUrl = ''
  let capturedBody = null
  global.fetch = async (url, init) => {
    capturedUrl = String(url)
    capturedBody = JSON.parse(init.body)
    return mockJsonResponse({ success: true })
  }

  await evolutionOrchestrator.markMessagesAsRead(4, '5511988887777', [
    { id: 'msg-1', fromMe: false, remoteJid: '5511988887777' },
    { id: 'msg-2', fromMe: true, remoteJid: '5511988887777@s.whatsapp.net' }
  ])

  assert.equal(capturedUrl, 'http://evolution.local/chat/markMessageAsRead/crm-channel-4')
  assert.deepEqual(capturedBody, {
    readMessages: [
      { id: 'msg-1', fromMe: false, remoteJid: '5511988887777@s.whatsapp.net' },
      { id: 'msg-2', fromMe: true, remoteJid: '5511988887777@s.whatsapp.net' }
    ]
  })
})

test('media download and webhook use the expected Evolution endpoints', async () => {
  process.env.EVOLUTION_API_URL = 'http://evolution.local'

  const calls = []
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return mockJsonResponse({ success: true })
  }

  await evolutionOrchestrator.getBase64FromMediaMessage(5, { key: { id: 'mid-9' } }, { convertToMp4: true })
  await evolutionOrchestrator.setWebhook(5, 'https://crm.local/webhook', {
    events: ['MESSAGES_UPSERT'],
    headers: { 'x-test': '1' },
    byEvents: true
  })

  assert.deepEqual(calls, [
    {
      url: 'http://evolution.local/chat/getBase64FromMediaMessage/crm-channel-5',
      body: {
        message: { key: { id: 'mid-9' } },
        convertToMp4: true
      }
    },
    {
      url: 'http://evolution.local/webhook/set/crm-channel-5',
      body: {
        webhook: {
          enabled: true,
          url: 'https://crm.local/webhook',
          events: ['MESSAGES_UPSERT'],
          headers: { 'x-test': '1' },
          byEvents: true
        }
      }
    }
  ])
})

test('fetchMessages retries once without invoking a host recovery endpoint', async () => {
  process.env.EVOLUTION_API_URL = 'http://evolution.local'
  process.env.EVOLUTION_RETRY_DELAY_MS = '0'

  const calls = []
  global.fetch = async (url, init) => {
    const method = init?.method || 'GET'
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ url: String(url), method, body })

    if (String(url).includes('/chat/findMessages/')) {
      const callIndex = calls.filter((item) => item.url.includes('/chat/findMessages/')).length
      if (callIndex === 1) {
        return mockJsonResponse({ error: 'upstream unavailable' }, { ok: false, status: 503 })
      }
      return mockJsonResponse({ messages: { records: [] } })
    }

    return mockJsonResponse({ ok: true })
  }

  const out = await evolutionOrchestrator.fetchMessages(1, '5511999998888', { limit: 20, page: 1 })
  assert.ok(out?.messages)

  const findMessagesCalls = calls.filter((item) => item.url.includes('/chat/findMessages/'))
  assert.equal(findMessagesCalls.length, 2)
  assert.equal(calls.length, 2)
})
