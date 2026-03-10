export type CrmAuthUser = {
  id: string
  username?: string
  displayName?: string
  name?: string
  email?: string
  role?: string
  allowedUnits?: string[]
  allowedModules?: string[]
}

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

function normalizeRole(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase()
  if (!raw) return ''
  if (raw === 'ADMIN') return 'GESTOR'
  if (raw === 'OPERADOR') return 'INJETOR'
  return raw
}

function parseBoolean(value: unknown): boolean | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false
  return null
}

function isLocalHostname(hostname: string): boolean {
  const host = String(hostname || '').trim().toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

function parseList(value: unknown): string[] | undefined {
  const raw = String(value || '').trim()
  if (!raw) return undefined
  const items = raw.split(',').map((item) => item.trim()).filter(Boolean)
  return items.length ? items : undefined
}

function parseCookieValue(rawCookie: string, name: string): string {
  const cookie = String(rawCookie || '')
  if (!cookie || !name) return ''
  const parts = cookie.split(';')
  for (const part of parts) {
    const [k, ...rest] = part.split('=')
    if (String(k || '').trim() !== name) continue
    return decodeURIComponent(rest.join('=').trim())
  }
  return ''
}

export function isLocalDevAuthBypassEnabled(context: any): boolean {
  const env = context?.env || {}
  const rawToggle =
    env.LOCAL_AUTH_BYPASS ??
    env.CRM_LOCAL_NO_AUTH ??
    env.DEV_AUTH_BYPASS ??
    ''
  const toggle = parseBoolean(rawToggle)
  if (toggle !== true) return false
  const requestUrl = String(context?.request?.url || '')
  if (!requestUrl) return false
  let localHost = false
  try {
    const { hostname } = new URL(requestUrl)
    localHost = isLocalHostname(hostname)
  } catch {
    return false
  }
  if (!localHost) return false

  const cookieHeader = String(context?.request?.headers?.get?.('cookie') || '')
  const cookieToggle =
    parseCookieValue(cookieHeader, 'crm.localAuth') ||
    parseCookieValue(cookieHeader, 'crm_local_auth')
  const cookieBypass = parseBoolean(cookieToggle)
  if (cookieBypass === false) {
    return false
  }
  if (cookieBypass === true) {
    return true
  }

  return true
}

export function getLocalDevAuthUser(context: any): CrmAuthUser {
  const env = context?.env || {}
  const role = normalizeRole(env.LOCAL_AUTH_ROLE || env.DEV_AUTH_ROLE || 'GESTOR') || 'GESTOR'
  const email = String(env.LOCAL_AUTH_EMAIL || env.DEV_AUTH_EMAIL || 'dev@local.test').trim() || 'dev@local.test'
  const username = String(env.LOCAL_AUTH_USERNAME || email.split('@')[0] || 'dev').trim() || 'dev'
  const displayName = String(env.LOCAL_AUTH_NAME || env.DEV_AUTH_NAME || 'Dev Local').trim() || 'Dev Local'
  const allowedUnits =
    parseList(env.LOCAL_AUTH_ALLOWED_UNITS) ||
    parseList(env.DEV_AUTH_ALLOWED_UNITS)
  const allowedModules =
    parseList(env.LOCAL_AUTH_ALLOWED_MODULES) ||
    parseList(env.DEV_AUTH_ALLOWED_MODULES)

  return {
    id: username,
    username,
    displayName,
    name: displayName,
    email,
    role,
    allowedUnits,
    allowedModules,
  }
}

export async function getCrmUser(context: any): Promise<CrmAuthUser | null> {
  if (isLocalDevAuthBypassEnabled(context)) {
    return getLocalDevAuthUser(context)
  }

  const env = context?.env || {}
  const requestOrigin = (() => {
    try {
      const url = context?.request?.url
      if (!url) return ''
      return new URL(url).origin
    } catch {
      return ''
    }
  })()
  const targetOrigin =
    (env.AUTH_API_TARGET as string | undefined) ||
    requestOrigin ||
    (env.INSUMOS_API_TARGET as string | undefined) ||
    'https://api.skincos.com.br'

  const normalizeAuthPrefix = (value: unknown) => {
    let prefix = String(value ?? '').trim()
    if (!prefix) return '/api/auth'
    if (!prefix.startsWith('/')) prefix = `/${prefix}`
    return prefix.replace(/\/$/, '')
  }
  const primaryPrefix = normalizeAuthPrefix(env.AUTH_PATH_PREFIX)
  const candidates = [primaryPrefix]
  if (primaryPrefix !== '/auth') candidates.push('/auth')
  if (primaryPrefix !== '/api/auth') candidates.push('/api/auth')

  const headers = new Headers()
  headers.set('accept', 'application/json')
  const cookie = context?.request?.headers?.get?.('cookie')
  if (cookie) headers.set('cookie', cookie)

  let res: Response | null = null
  for (const prefix of candidates) {
    const url = new URL(targetOrigin)
    // Auth backend path (internal implementation detail; UI/docs must not mention it)
    url.pathname = `${prefix}/me`
    res = await fetch(url.toString(), { method: 'GET', headers, redirect: 'manual' }).catch(() => null)
    if (!res) continue
    if (res.ok) break
    if (res.status === 404 || res.status === 405) {
      res = null
      continue
    }
    return null
  }
  if (!res || !res.ok) return null

  const data = await res.json().catch(() => null)
  const raw = data?.user || data?.usuario || data || null
  const username = raw?.username || undefined
  const email = raw?.email || undefined
  const id = username || email || raw?.id
  if (!id) return null

  const displayName = raw?.displayName || raw?.name || raw?.username || raw?.email || undefined
  return {
    id: String(id),
    username: username ? String(username) : undefined,
    displayName: displayName ? String(displayName) : undefined,
    name: displayName ? String(displayName) : undefined,
    email: email ? String(email) : undefined,
    role: normalizeRole(raw?.role || undefined) || undefined,
    allowedUnits: Array.isArray(raw?.allowedUnits) ? raw.allowedUnits : undefined,
    allowedModules: Array.isArray(raw?.allowedModules) ? raw.allowedModules : undefined,
  }
}

export async function requireCrmUser(context: any): Promise<CrmAuthUser | Response> {
  const user = await getCrmUser(context)
  if (!user) return json(401, { ok: false, error: 'UNAUTHORIZED', hint: 'Faça login no CRM para continuar.' })
  return user
}
