const DEFAULT_CHANNELS = Array.from({ length: 9 }, (_, i) => i + 1)
const DEFAULT_INSTANCE_PREFIX = 'crm-channel-'
const DEBUG_QR = String(process.env.WA_DEBUG_QR || '').toLowerCase() === 'true'

function resolveEvolutionConfig() {
  const baseUrl =
    process.env.EVOLUTION_API_URL ||
    process.env.EVOLUTION_API_TARGET ||
    process.env.WHATSAPP_EVOLUTION_API_URL ||
    ''
  const apiKey = process.env.EVOLUTION_API_KEY || process.env.EVOLUTION_API_TOKEN || process.env.WHATSAPP_EVOLUTION_API_KEY || ''
  const instancePrefix = process.env.EVOLUTION_INSTANCE_PREFIX || DEFAULT_INSTANCE_PREFIX
  return { baseUrl, apiKey, instancePrefix }
}

function normalizeState(raw) {
  if (!raw) return 'unknown'
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object' && raw.state) return String(raw.state)
  return 'unknown'
}

function mapStateToStatus(state) {
  const normalized = String(state || '').toLowerCase()
  if (normalized === 'open' || normalized === 'connected') return 'connected'
  if (normalized === 'connecting') return 'qr_pending'
  if (normalized === 'close' || normalized === 'closed') return 'free'
  if (normalized === 'available') return 'available'
  return 'error'
}

function channelName(channel, instancePrefix) {
  return `${instancePrefix}${channel}`
}

function normalizeRemoteJid(remoteJid) {
  if (!remoteJid) return ''
  const value = String(remoteJid).trim()
  if (!value) return ''
  if (value.includes('@g.us') || value.includes('@broadcast')) return value
  const localPart = value.includes('@') ? value.split('@')[0] : value
  const normalizedLocal = localPart.split(':')[0].replace(/\D/g, '')
  if (normalizedLocal) return `${normalizedLocal}@s.whatsapp.net`
  if (value.includes('@')) return value
  return `${value}@s.whatsapp.net`
}

function normalizeNumber(numberOrJid) {
  if (!numberOrJid) return ''
  const value = String(numberOrJid).trim()
  if (!value) return ''
  if (value.includes('@g.us')) return value
  if (value.includes('@s.whatsapp.net')) return value.split('@')[0]
  return value
}

function extractQrCandidate(result) {
  if (!result) return null
  return (
    result?.qrcode ||
    result?.qr ||
    result?.instance?.qrcode ||
    result?.base64 ||
    result?.instance?.base64 ||
    result?.code ||
    result?.instance?.code ||
    null
  )
}

function extractQrFromText(text) {
  if (!text) return null
  const dataUrlMatch = text.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/)
  if (dataUrlMatch) return dataUrlMatch[0]
  const jsonFieldMatch = text.match(/"(?:base64|qrcode|qr|code)"\s*:\s*"([^"]+)"/i)
  if (jsonFieldMatch?.[1]) return jsonFieldMatch[1]
  return null
}

function normalizeQrValue(raw) {
  if (raw == null) return null
  const value = String(raw).trim()
  if (!value) return null

  if (value.startsWith('data:image')) {
    return value.replace(/\\\//g, '/')
  }

  const unescaped = value.replace(/\\\//g, '/')
  if (unescaped.startsWith('data:image')) return unescaped

  const looksLikeBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length > 120
  if (looksLikeBase64) {
    if (value.startsWith('iVBOR')) return `data:image/png;base64,${value}`
    if (value.startsWith('/9j/')) return `data:image/jpeg;base64,${value}`
    return `data:image/png;base64,${value}`
  }

  return value
}

function debugQr(event, payload = {}) {
  if (!DEBUG_QR) return
  try {
    const serialized = JSON.stringify(payload)
    console.log(`[WA_QR_DEBUG] ${event} ${serialized}`)
  } catch {
    console.log(`[WA_QR_DEBUG] ${event}`)
  }
}

async function evolutionFetch(path, options = {}) {
  const { baseUrl, apiKey } = resolveEvolutionConfig()
  if (!baseUrl) {
    throw new Error('EVOLUTION_API_URL not configured')
  }
  const url = new URL(path, baseUrl)
  const headers = new Headers(options.headers || {})
  if (apiKey) headers.set('apikey', apiKey)
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json')

  const res = await fetch(url.toString(), {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { ok: res.ok, status: res.status, json, text }
}

async function fetchInstances() {
  const res = await evolutionFetch('/instance/fetchInstances')
  if (!res.ok) {
    const message = res.json?.error || res.json?.message || res.text || `HTTP ${res.status}`
    throw new Error(message)
  }
  if (Array.isArray(res.json)) return res.json
  if (Array.isArray(res.json?.instances)) return res.json.instances
  return []
}

async function ensureInstance(channel, instanceName) {
  const instances = await fetchInstances()
  const existing = instances.find((inst) => String(inst?.name) === instanceName)
  if (existing) return existing

  const res = await evolutionFetch('/instance/create', {
    method: 'POST',
    body: {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true
    }
  })
  if (!res.ok) {
    const message = res.json?.error || res.json?.message || res.text || `HTTP ${res.status}`
    throw new Error(message)
  }
  return res.json?.instance || null
}

async function connectInstance(instanceName) {
  const res = await evolutionFetch(`/instance/connect/${encodeURIComponent(instanceName)}`)
  debugQr('connectInstance:response', {
    instanceName,
    ok: res.ok,
    status: res.status,
    hasJson: !!res.json,
    jsonKeys: res.json ? Object.keys(res.json).slice(0, 12) : [],
    textLength: res.text ? res.text.length : 0
  })
  if (!res.ok) {
    const message = res.json?.error || res.json?.message || res.text || `HTTP ${res.status}`
    throw new Error(message)
  }
  if (res.json) return res.json
  if (res.text) return { rawText: res.text }
  return null
}

async function getStatus() {
  const { instancePrefix } = resolveEvolutionConfig()
  const instances = await fetchInstances()
  const channels = DEFAULT_CHANNELS.map((channel) => {
    const name = channelName(channel, instancePrefix)
    const instance = instances.find((inst) => String(inst?.name) === name)
    if (!instance) {
      return {
        id: `wa-channel-${channel}`,
        channel,
        port: 3001,
        status: 'free',
        name: `WhatsApp Channel ${channel}`,
        createdAt: null,
        updatedAt: null
      }
    }
    const state = normalizeState(instance.connectionStatus)
    const status = mapStateToStatus(state)
    return {
      id: `wa-channel-${channel}`,
      channel,
      port: 3001,
      status,
      name: instance.profileName || instance.name || `WhatsApp Channel ${channel}`,
      createdAt: instance.createdAt || null,
      updatedAt: instance.updatedAt || null,
      metadata: {
        phoneNumber: instance.number || instance.ownerJid || null,
        errorMessage: instance.disconnectionReasonCode || null
      }
    }
  })

  return {
    totalChannels: DEFAULT_CHANNELS.length,
    availableChannels: channels.filter((c) => c.status === 'free').length,
    freeInstances: channels.filter((c) => c.status === 'free').length,
    connectedInstances: channels.filter((c) => c.status === 'connected').length,
    errorInstances: channels.filter((c) => c.status === 'error').length,
    startingInstances: channels.filter((c) => c.status === 'starting' || c.status === 'qr_pending').length,
    channels
  }
}

async function getChannelStatus(channel) {
  const status = await getStatus()
  const entry = status.channels.find((c) => c.channel === channel)
  if (!entry) {
    return { error: `Channel ${channel} not found` }
  }
  return { status: entry.status, channel, port: entry.port, instance: entry }
}

async function getChannelQR(channel) {
  const { instancePrefix } = resolveEvolutionConfig()
  const name = channelName(channel, instancePrefix)
  const result = await connectInstance(name)
  let qr = extractQrCandidate(result)
  if (!qr && result?.rawText) {
    qr = extractQrFromText(result.rawText)
  }
  qr = normalizeQrValue(qr)
  const state = normalizeState(result?.instance?.status || result?.instance?.state || result?.state)
  let status = mapStateToStatus(state)
  if (qr && status === 'error') status = 'qr_pending'
  debugQr('getChannelQR:resolved', {
    channel,
    instanceName: name,
    status,
    hasQr: !!qr,
    qrType: qr ? (String(qr).startsWith('data:image') ? 'image-data-url' : 'raw-text') : null,
    qrLength: typeof qr === 'string' ? qr.length : 0,
    qrPrefix: typeof qr === 'string' ? qr.slice(0, 24) : null
  })
  return { qr, status, channel, port: 3001 }
}

async function startChannel(channel, nameOverride) {
  const { instancePrefix } = resolveEvolutionConfig()
  const instanceName = channelName(channel, instancePrefix)
  await ensureInstance(channel, instanceName)
  const connect = await connectInstance(instanceName)
  let qr = extractQrCandidate(connect)
  if (!qr && connect?.rawText) {
    qr = extractQrFromText(connect.rawText)
  }
  qr = normalizeQrValue(qr)
  const state = normalizeState(connect?.instance?.status || connect?.instance?.state || connect?.state)
  let status = mapStateToStatus(state)
  if (qr && status === 'error') status = 'qr_pending'
  debugQr('startChannel:resolved', {
    channel,
    instanceName,
    status,
    hasQr: !!qr,
    qrType: qr ? (String(qr).startsWith('data:image') ? 'image-data-url' : 'raw-text') : null,
    qrLength: typeof qr === 'string' ? qr.length : 0,
    qrPrefix: typeof qr === 'string' ? qr.slice(0, 24) : null
  })
  return {
    success: true,
    instance: {
      channel,
      port: 3001,
      name: nameOverride || instanceName,
      status
    },
    qr
  }
}

async function stopChannel(channel) {
  const { instancePrefix } = resolveEvolutionConfig()
  const name = channelName(channel, instancePrefix)
  const res = await evolutionFetch(`/instance/logout/${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!res.ok) {
    const message = res.json?.error || res.json?.message || res.text || `HTTP ${res.status}`
    throw new Error(message)
  }
  return { success: true, channel, port: 3001 }
}

async function restartChannel(channel) {
  const { instancePrefix } = resolveEvolutionConfig()
  const name = channelName(channel, instancePrefix)
  const res = await evolutionFetch(`/instance/restart/${encodeURIComponent(name)}`, { method: 'POST' })
  if (!res.ok) {
    const message = res.json?.error || res.json?.message || res.text || `HTTP ${res.status}`
    throw new Error(message)
  }
  return { success: true, channel, port: 3001 }
}

async function fetchChats(channel, { limit = 50, offset = 0 } = {}) {
  const { instancePrefix } = resolveEvolutionConfig()
  const name = channelName(channel, instancePrefix)
  const res = await evolutionFetch(`/chat/findChats/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: {
      take: limit,
      skip: offset
    }
  })
  if (!res.ok) {
    const message = res.json?.error || res.json?.message || res.text || `HTTP ${res.status}`
    throw new Error(message)
  }
  return res.json
}

async function fetchMessages(channel, remoteJid, { limit = 50, page = 1 } = {}) {
  const { instancePrefix } = resolveEvolutionConfig()
  const name = channelName(channel, instancePrefix)
  const jid = normalizeRemoteJid(remoteJid)
  const res = await evolutionFetch(`/chat/findMessages/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: {
      where: {
        key: {
          remoteJid: jid
        }
      },
      offset: limit,
      page
    }
  })
  if (!res.ok) {
    const message = res.json?.error || res.json?.message || res.text || `HTTP ${res.status}`
    throw new Error(message)
  }
  return res.json
}

async function sendText(channel, remoteJid, text, options = {}) {
  const { instancePrefix } = resolveEvolutionConfig()
  const name = channelName(channel, instancePrefix)
  const number = normalizeNumber(remoteJid)
  if (!number) {
    throw new Error('Número inválido para envio.')
  }
  const replyToMessageId = String(options?.replyToMessageId || '').trim()
  const replyToPreview = String(options?.replyToPreview || '').trim()
  const payload = {
    number,
    text
  }
  if (replyToMessageId) {
    payload.quoted = {
      key: {
        id: replyToMessageId,
        remoteJid: normalizeRemoteJid(remoteJid),
        fromMe: false
      },
      message: replyToPreview ? { conversation: replyToPreview } : undefined
    }
  }
  const res = await evolutionFetch(`/message/sendText/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: payload
  })
  if (!res.ok) {
    const message = res.json?.error || res.json?.message || res.text || `HTTP ${res.status}`
    throw new Error(message)
  }
  return res.json
}

async function setWebhook(channel, url, { events = [], headers = {}, byEvents = false } = {}) {
  const { instancePrefix } = resolveEvolutionConfig()
  const name = channelName(channel, instancePrefix)
  const res = await evolutionFetch(`/webhook/set/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: {
      webhook: {
        enabled: true,
        url,
        events,
        headers,
        byEvents
      }
    }
  })
  if (!res.ok) {
    const message = res.json?.error || res.json?.message || res.text || `HTTP ${res.status}`
    throw new Error(message)
  }
  return res.json
}

export const evolutionOrchestrator = {
  getStatus,
  getChannelStatus,
  getChannelQR,
  startChannel,
  stopChannel,
  restartChannel,
  fetchChats,
  fetchMessages,
  sendText,
  setWebhook
}
