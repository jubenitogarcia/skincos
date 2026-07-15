const DEFAULT_CHANNELS = Array.from({ length: 9 }, (_, i) => i + 1)
const DEFAULT_INSTANCE_PREFIX = 'crm-channel-'
const DEBUG_QR = String(process.env.WA_DEBUG_QR || '').toLowerCase() === 'true'
const AUTO_RECOVERY_TAG = 'evolution-auto-recovery'
let autoRecoveryInFlight = null
let autoRecoveryLastAt = 0
let autoRecoverySuppressionDepth = 0

function resolveEvolutionConfig() {
  const baseUrl =
    process.env.EVOLUTION_API_URL ||
    process.env.EVOLUTION_API_TARGET ||
    process.env.WHATSAPP_EVOLUTION_API_URL ||
    'http://127.0.0.1:8080'
  const apiKey = process.env.EVOLUTION_API_KEY || process.env.EVOLUTION_API_TOKEN || process.env.WHATSAPP_EVOLUTION_API_KEY || ''
  const instancePrefix = process.env.EVOLUTION_INSTANCE_PREFIX || DEFAULT_INSTANCE_PREFIX
  return { baseUrl, apiKey, instancePrefix }
}

function resolveAutoRecoveryConfig() {
  const enabled = String(
    process.env.EVOLUTION_AUTO_RECOVERY_ENABLED ||
    process.env.WA_EVOLUTION_AUTO_RECOVERY_ENABLED ||
    'true'
  ).toLowerCase() !== 'false'
  const endpoint = String(
    process.env.EVOLUTION_AUTO_RECOVERY_ENDPOINT ||
    `http://127.0.0.1:${process.env.CRM_API_PORT || process.env.PORT || '8099'}/api/wa-orchestrator/local/recovery/restart`
  ).trim()
  const mode = String(process.env.EVOLUTION_AUTO_RECOVERY_MODE || 'evolution').trim().toLowerCase() === 'stack'
    ? 'stack'
    : 'evolution'
  const cooldownMs = Math.max(
    1000,
    Number.parseInt(String(process.env.EVOLUTION_AUTO_RECOVERY_COOLDOWN_MS || '30000'), 10) || 30000
  )
  const retryDelayMs = Math.max(
    0,
    Number.parseInt(String(process.env.EVOLUTION_AUTO_RECOVERY_RETRY_DELAY_MS || '1200'), 10) || 1200
  )
  const requestTimeoutMs = Math.max(
    3000,
    Number.parseInt(String(process.env.EVOLUTION_FETCH_TIMEOUT_MS || '22000'), 10) || 22000
  )
  return { enabled, endpoint, mode, cooldownMs, retryDelayMs, requestTimeoutMs }
}

function wait(ms) {
  if (!ms) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRecoverableStatus(status) {
  const code = Number(status || 0)
  return code >= 500 || code === 429
}

function isRecoverableTransportError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('networkerror') ||
    message.includes('network error') ||
    message.includes('econnrefused') ||
    message.includes('ehostunreach') ||
    message.includes('etimedout') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('abort') ||
    message.includes('timed out')
  )
}

async function triggerAutoRecovery(reason, context = {}) {
  const config = resolveAutoRecoveryConfig()
  if (!config.enabled || !config.endpoint) {
    return { success: false, skipped: 'disabled' }
  }

  const now = Date.now()
  if (now - autoRecoveryLastAt < config.cooldownMs) {
    return { success: false, skipped: 'cooldown' }
  }

  if (autoRecoveryInFlight) {
    return autoRecoveryInFlight
  }

  autoRecoveryInFlight = (async () => {
    const payload = {
      mode: config.mode,
      trigger: AUTO_RECOVERY_TAG,
      reason: String(reason || '').slice(0, 200) || 'Evolution request failure',
      context: {
        path: String(context?.path || ''),
        status: Number(context?.status || 0) || undefined
      }
    }
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const rawText = await response.text()
      let json = null
      try {
        json = rawText ? JSON.parse(rawText) : null
      } catch {
        json = null
      }
      const success = Boolean(response.ok && (json?.success !== false))
      if (success) {
        autoRecoveryLastAt = Date.now()
      }
      console.warn('[EVOLUTION_AUTO_RECOVERY] trigger result', {
        success,
        status: response.status,
        mode: config.mode,
        reason: payload.reason
      })
      return { success, status: response.status, payload: json || rawText || null }
    } catch (error) {
      console.warn('[EVOLUTION_AUTO_RECOVERY] trigger failed', {
        error: error?.message || String(error)
      })
      return { success: false, error: error?.message || String(error) }
    } finally {
      autoRecoveryInFlight = null
    }
  })()

  return autoRecoveryInFlight
}

async function runWithoutAutoRecovery(task) {
  autoRecoverySuppressionDepth += 1
  try {
    return await task()
  } finally {
    autoRecoverySuppressionDepth = Math.max(0, autoRecoverySuppressionDepth - 1)
  }
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
  if (
    normalized === 'close' ||
    normalized === 'closed' ||
    normalized === 'available' ||
    normalized === 'disconnected' ||
    normalized === 'disconnect' ||
    normalized === 'stopped' ||
    normalized === 'idle' ||
    normalized === 'logout'
  ) return 'free'
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
  const digits = value.replace(/\D/g, '')
  if (digits) return `${digits}@s.whatsapp.net`
  return `${value}@s.whatsapp.net`
}

function normalizeNumber(numberOrJid) {
  if (!numberOrJid) return ''
  const value = String(numberOrJid).trim()
  if (!value) return ''
  if (value.includes('@g.us')) return value
  if (value.includes('@')) {
    const localPart = value.split('@')[0]
    const digits = localPart.replace(/\D/g, '')
    return digits || localPart
  }
  const digits = value.replace(/\D/g, '')
  return digits || value
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

function resolveEvolutionErrorMessage(responseLike) {
  const json = responseLike?.json
  const direct = String(json?.error || json?.message || '').trim()
  if (direct && direct.toLowerCase() !== 'internal server error') return direct
  const nestedMessage = json?.response?.message
  if (Array.isArray(nestedMessage)) {
    for (const entry of nestedMessage) {
      if (typeof entry === 'string' && entry.trim()) return entry.trim()
      if (entry && typeof entry === 'object') {
        const candidate = String(entry?.message?.[1] || entry?.message || entry?.error || '').trim()
        if (candidate) return candidate
      }
    }
  }
  const fallback = String(responseLike?.text || '').trim()
  if (fallback) return fallback
  return `HTTP ${Number(responseLike?.status) || 500}`
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

async function evolutionFetch(path, options = {}, attempt = 0) {
  const { baseUrl, apiKey } = resolveEvolutionConfig()
  const recoveryConfig = resolveAutoRecoveryConfig()
  const canAutoRecover = recoveryConfig.enabled && autoRecoverySuppressionDepth === 0 && !options?.disableAutoRecovery
  if (!baseUrl) {
    throw new Error('EVOLUTION_API_URL not configured')
  }
  const url = new URL(path, baseUrl)
  const headers = new Headers(options.headers || {})
  if (apiKey) headers.set('apikey', apiKey)
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`Evolution request timeout after ${recoveryConfig.requestTimeoutMs}ms`)), recoveryConfig.requestTimeoutMs)

  let res
  try {
    res = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    })
  } catch (error) {
    if (attempt === 0 && canAutoRecover && isRecoverableTransportError(error)) {
      await triggerAutoRecovery(error?.message || 'Evolution transport error', { path, status: 0 })
      await wait(recoveryConfig.retryDelayMs)
      return evolutionFetch(path, options, 1)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok && attempt === 0 && canAutoRecover && isRecoverableStatus(res.status)) {
    await triggerAutoRecovery(`Evolution HTTP ${res.status}`, { path, status: res.status })
    await wait(recoveryConfig.retryDelayMs)
    return evolutionFetch(path, options, 1)
  }

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

function normalizeInstanceSettingsPayload(raw = {}) {
  return {
    rejectCall: Boolean(raw?.rejectCall),
    msgCall: typeof raw?.msgCall === 'string' ? raw.msgCall : '',
    groupsIgnore: Boolean(raw?.groupsIgnore),
    alwaysOnline: Boolean(raw?.alwaysOnline),
    readMessages: Boolean(raw?.readMessages),
    readStatus: Boolean(raw?.readStatus),
    syncFullHistory: Boolean(raw?.syncFullHistory),
    wavoipToken: typeof raw?.wavoipToken === 'string' ? raw.wavoipToken : ''
  }
}

async function ensureHistorySyncEnabled(instanceName) {
  try {
    const currentRes = await evolutionFetch(`/settings/find/${encodeURIComponent(instanceName)}`, {
      disableAutoRecovery: true
    })
    let payload = normalizeInstanceSettingsPayload(currentRes?.json || {})
    if (payload.syncFullHistory) return
    payload = {
      ...payload,
      syncFullHistory: true
    }
    const setRes = await evolutionFetch(`/settings/set/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: payload,
      disableAutoRecovery: true
    })
    if (!setRes.ok) {
      console.warn('[WA_ORCHESTRATOR] Failed to enforce syncFullHistory', {
        instanceName,
        status: setRes.status
      })
      return
    }
    console.info('[WA_ORCHESTRATOR] syncFullHistory enabled', { instanceName })
  } catch (error) {
    console.warn('[WA_ORCHESTRATOR] Could not verify/enforce syncFullHistory', {
      instanceName,
      error: error?.message || String(error)
    })
  }
}

async function connectInstance(instanceName) {
  await ensureHistorySyncEnabled(instanceName)
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

function isAlreadyDisconnectedMessage(message) {
  const value = String(message || '').toLowerCase()
  return (
    value.includes('not connected') ||
    value.includes('is not connected') ||
    value.includes('already disconnected') ||
    value.includes('já desconectado') ||
    value.includes('nao conectado') ||
    value.includes('não conectado')
  )
}

async function getInstanceConnectionState(instanceName) {
  try {
    const res = await evolutionFetch(`/instance/connectionState/${encodeURIComponent(instanceName)}`, {
      disableAutoRecovery: true
    })
    if (!res.ok) return null
    const rawState = res?.json?.instance?.state ?? res?.json?.state ?? null
    if (rawState == null) return null
    const state = normalizeState(rawState)
    return state === 'unknown' ? null : state
  } catch {
    return null
  }
}

async function getStatus() {
  const { instancePrefix } = resolveEvolutionConfig()
  let instances = []
  let providerError = null
  try {
    instances = await fetchInstances()
  } catch (error) {
    providerError = error instanceof Error ? error.message : String(error)
  }

  if (providerError) {
    const channels = DEFAULT_CHANNELS.map((channel) => ({
      id: `wa-channel-${channel}`,
      channel,
      port: 3001,
      status: 'error',
      name: `WhatsApp Channel ${channel}`,
      createdAt: null,
      updatedAt: null,
      metadata: {
        phoneNumber: null,
        errorMessage: providerError
      }
    }))
    return {
      totalChannels: DEFAULT_CHANNELS.length,
      availableChannels: 0,
      freeInstances: 0,
      connectedInstances: 0,
      errorInstances: channels.length,
      startingInstances: 0,
      providerOnline: false,
      providerError,
      channels
    }
  }

  const channels = await Promise.all(DEFAULT_CHANNELS.map(async (channel) => {
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
    let state = normalizeState(instance.connectionStatus)
    let status = mapStateToStatus(state)
    if (status !== 'free') {
      const liveState = await getInstanceConnectionState(name)
      if (liveState) {
        state = liveState
        status = mapStateToStatus(state)
      }
    }
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
        errorMessage: status === 'connected' ? null : (instance.disconnectionReasonCode || null)
      }
    }
  }))

  return {
    totalChannels: DEFAULT_CHANNELS.length,
    availableChannels: channels.filter((c) => c.status === 'free').length,
    freeInstances: channels.filter((c) => c.status === 'free').length,
    connectedInstances: channels.filter((c) => c.status === 'connected').length,
    errorInstances: channels.filter((c) => c.status === 'error').length,
    startingInstances: channels.filter((c) => c.status === 'starting' || c.status === 'qr_pending').length,
    providerOnline: true,
    providerError: null,
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
    const message = resolveEvolutionErrorMessage(res)
    if (!isAlreadyDisconnectedMessage(message)) {
      throw new Error(message)
    }
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const liveState = await getInstanceConnectionState(name)
    const mapped = mapStateToStatus(liveState)
    if (!liveState || mapped === 'free') {
      return { success: true, channel, port: 3001, state: liveState || 'close' }
    }
    await wait(700)
  }
  return { success: true, channel, port: 3001, state: 'disconnecting' }
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

async function fetchChats(channel, { limit = 50, offset = 0, archivedOnly = false, includeArchived = false } = {}) {
  const { instancePrefix } = resolveEvolutionConfig()
  const name = channelName(channel, instancePrefix)
  const normalizedLimit = Math.max(1, Number(limit) || 50)
  const normalizedOffset = Math.max(0, Number(offset) || 0)
  const where = archivedOnly
    ? { archived: true }
    : (includeArchived ? undefined : { archived: false })
  const res = await evolutionFetch(`/chat/findChats/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: {
      take: normalizedLimit,
      skip: normalizedOffset,
      ...(where ? { where } : {})
    }
  })
  if (!res.ok) {
    const message = res.json?.error || res.json?.message || res.text || `HTTP ${res.status}`
    throw new Error(message)
  }
  return res.json
}

async function fetchContacts(channel, { limit = 200, page = 1, remoteJid = '' } = {}) {
  const { instancePrefix } = resolveEvolutionConfig()
  const name = channelName(channel, instancePrefix)
  const where = {}
  if (remoteJid) {
    where.remoteJid = normalizeRemoteJid(remoteJid)
  }
  const res = await evolutionFetch(`/chat/findContacts/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: {
      where,
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

async function archiveChat(channel, remoteJid, archive = true) {
  const { instancePrefix } = resolveEvolutionConfig()
  const name = channelName(channel, instancePrefix)
  const jid = normalizeRemoteJid(remoteJid)
  if (!jid) {
    throw new Error('remoteJid is required')
  }
  const res = await evolutionFetch(`/chat/archiveChat/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: {
      chat: jid,
      archive: Boolean(archive)
    }
  })
  if (!res.ok) {
    const message = resolveEvolutionErrorMessage(res)
    throw new Error(message)
  }
  return res.json
}

function normalizeReadMessageKey(rawKey, fallbackRemoteJid) {
  const messageId = String(rawKey?.id || '').trim()
  const candidateRemoteJid = String(rawKey?.remoteJid || fallbackRemoteJid || '').trim()
  const normalizedRemote = normalizeRemoteJid(candidateRemoteJid)
  if (!messageId || !normalizedRemote) return null
  return {
    id: messageId,
    fromMe: Boolean(rawKey?.fromMe),
    remoteJid: normalizedRemote
  }
}

async function markMessagesAsRead(channel, remoteJid, readMessages = []) {
  const { instancePrefix } = resolveEvolutionConfig()
  const name = channelName(channel, instancePrefix)
  const fallbackRemoteJid = normalizeRemoteJid(remoteJid)
  const keys = (Array.isArray(readMessages) ? readMessages : [])
    .map((entry) => normalizeReadMessageKey(entry, fallbackRemoteJid))
    .filter(Boolean)

  if (!keys.length) {
    throw new Error('No valid message keys for mark as read.')
  }

  const res = await evolutionFetch(`/chat/markMessageAsRead/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: {
      readMessages: keys
    }
  })
  if (!res.ok) {
    const message = res.json?.error || res.json?.message || res.text || `HTTP ${res.status}`
    throw new Error(message)
  }
  return res.json
}

async function getBase64FromMediaMessage(channel, message, { convertToMp4 = false } = {}) {
  const { instancePrefix } = resolveEvolutionConfig()
  const name = channelName(channel, instancePrefix)
  const keyId = String(message?.key?.id || '').trim()
  if (!keyId) {
    throw new Error('Message key.id is required for media download.')
  }
  const res = await evolutionFetch(`/chat/getBase64FromMediaMessage/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: {
      message,
      convertToMp4: Boolean(convertToMp4)
    }
  })
  if (!res.ok) {
    const messageText = res.json?.error || res.json?.message || res.text || `HTTP ${res.status}`
    throw new Error(messageText)
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
  fetchContacts,
  fetchChats,
  fetchMessages,
  sendText,
  archiveChat,
  markMessagesAsRead,
  getBase64FromMediaMessage,
  setWebhook,
  runWithoutAutoRecovery
}
