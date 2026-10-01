export type PontoAuthUser = {
  id: string
  username?: string
  displayName?: string
  name?: string
  email?: string
  role?: string
  allowedUnits?: string[]
}

function parseBoolean(value: unknown): boolean | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  return null
}

function parseList(value: unknown): string[] | undefined {
  const values = String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
  return values.length ? values : undefined
}

function readCookie(cookieHeader: string, name: string): string {
  for (const part of String(cookieHeader || '').split(';')) {
    const [key, ...rest] = part.split('=')
    if (String(key || '').trim() === name) return decodeURIComponent(rest.join('=').trim())
  }
  return ''
}

function isLoopback(hostname: string): boolean {
  const value = String(hostname || '').trim().toLowerCase()
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]'
}

export function normalizePontoRole(value: unknown): string {
  const role = String(value || '').trim().toUpperCase()
  if (role === 'RH' || role === 'AUDITOR') return 'SUPERVISOR'
  if (role === 'EMPLOYEE') return 'CONSULTOR'
  return role
}

export function isLocalDevAuthBypassEnabled(context: any): boolean {
  const env = context?.env || {}
  const enabled = parseBoolean(env.LOCAL_AUTH_BYPASS ?? env.PONTO_LOCAL_AUTH_BYPASS ?? '')
  if (enabled !== true) return false
  let requestUrl: URL
  try {
    requestUrl = new URL(String(context?.request?.url || ''))
  } catch {
    return false
  }
  const allowed = parseList(env.LOCAL_AUTH_ALLOWED_HOSTS)?.map((host) => host.toLowerCase()) || []
  if (!isLoopback(requestUrl.hostname) && !allowed.includes(requestUrl.hostname.toLowerCase())) return false
  const cookieChoice = parseBoolean(readCookie(String(context?.request?.headers?.get?.('cookie') || ''), 'crm.localAuth'))
  return cookieChoice !== false
}

export function getLocalDevAuthUser(context: any): PontoAuthUser {
  const env = context?.env || {}
  const email = String(env.LOCAL_AUTH_EMAIL || 'dev@local.test').trim() || 'dev@local.test'
  const username = String(env.LOCAL_AUTH_USERNAME || email.split('@')[0] || 'dev').trim() || 'dev'
  const displayName = String(env.LOCAL_AUTH_NAME || 'Dev Local').trim() || 'Dev Local'
  return {
    id: username,
    username,
    displayName,
    name: displayName,
    email,
    role: normalizePontoRole(env.LOCAL_AUTH_ROLE || 'GESTOR') || 'GESTOR',
    allowedUnits: parseList(env.LOCAL_AUTH_ALLOWED_UNITS),
  }
}

function authTarget(context: any): string | null {
  const env = context?.env || {}
  const expectedByEnvironment: Record<string, string> = {
    production: 'https://api.skincos.com.br',
    staging: 'https://api-staging.skincos.com.br',
  }
  const expected = expectedByEnvironment[String(env.SKINCOS_DEPLOYMENT_ENV || '').trim().toLowerCase()]
  const configured = String(env.AUTH_API_TARGET || env.INSUMOS_API_TARGET || '').trim()
  if (!expected || configured !== expected) return null
  let requestOrigin = ''
  try {
    const request = new URL(String(context?.request?.url || ''))
    requestOrigin = request.origin
  } catch {
    return null
  }
  try {
    const target = new URL(configured)
    if (target.origin === requestOrigin || target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) return null
    return target.origin
  } catch {
    return null
  }
}

function authPrefixes(value: unknown): string[] {
  let primary = String(value || '').trim() || '/insumos/auth'
  if (!primary.startsWith('/')) primary = `/${primary}`
  primary = primary.replace(/\/$/, '')
  return [...new Set([primary, '/auth', '/api/auth'])]
}

export async function getPontoUser(context: any): Promise<PontoAuthUser | null> {
  if (isLocalDevAuthBypassEnabled(context)) return getLocalDevAuthUser(context)
  const target = authTarget(context)
  if (!target) return null
  const headers = new Headers({ accept: 'application/json' })
  const cookie = context?.request?.headers?.get?.('cookie')
  if (cookie) headers.set('cookie', cookie)
  let response: Response | null = null
  for (const prefix of authPrefixes(context?.env?.AUTH_PATH_PREFIX)) {
    response = await fetch(`${target}${prefix}/me`, { method: 'GET', headers, redirect: 'manual' }).catch(() => null)
    if (response?.ok) break
    if (!response || ![404, 405].includes(response.status)) return null
    response = null
  }
  if (!response?.ok) return null
  const payload: any = await response.json().catch(() => null)
  const raw = payload?.user || payload?.usuario || payload
  const username = raw?.username ? String(raw.username) : undefined
  const email = raw?.email ? String(raw.email) : undefined
  const id = username || email || (raw?.id ? String(raw.id) : '')
  if (!id) return null
  const displayName = raw?.displayName || raw?.name || username || email
  return {
    id,
    username,
    displayName: displayName ? String(displayName) : undefined,
    name: displayName ? String(displayName) : undefined,
    email,
    role: normalizePontoRole(raw?.role) || undefined,
    allowedUnits: Array.isArray(raw?.allowedUnits) ? raw.allowedUnits.map(String).filter(Boolean) : undefined,
  }
}
