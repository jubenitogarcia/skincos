const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

function parseCookies(cookieHeader = ''): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of String(cookieHeader || '').split(';')) {
    const value = part.trim()
    const separator = value.indexOf('=')
    if (separator <= 0) continue
    const key = value.slice(0, separator).trim()
    if (key) cookies[key] = value.slice(separator + 1).trim()
  }
  return cookies
}

function originGuard(request: Request): Response | null {
  const origin = request.headers.get('origin')
  if (!origin) return null
  try {
    if (origin !== new URL(request.url).origin) return json(403, { ok: false, error: 'FORBIDDEN', code: 'ORIGIN_INVALID' })
  } catch {
    return json(403, { ok: false, error: 'FORBIDDEN', code: 'ORIGIN_INVALID' })
  }
  return null
}

export function requireSameOrigin(context: any): Response | null {
  const request: Request | undefined = context?.request
  return request ? originGuard(request) : json(500, { ok: false, error: 'INTERNAL_ERROR', code: 'REQUEST_MISSING' })
}

export function requireCsrfForMutations(context: any): Response | null {
  const request: Request | undefined = context?.request
  if (!request) return json(500, { ok: false, error: 'INTERNAL_ERROR', code: 'REQUEST_MISSING' })
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(request.method || 'GET').toUpperCase())) return null
  const originResult = originGuard(request)
  if (originResult) return originResult
  const cookies = parseCookies(request.headers.get('cookie') || '')
  const csrfCookie = String(cookies.csrfToken || '').trim()
  const csrfHeader = String(request.headers.get('x-csrf-token') || request.headers.get('X-CSRF-Token') || '').trim()
  return csrfCookie && csrfHeader && csrfCookie === csrfHeader
    ? null
    : json(403, { ok: false, error: 'CSRF_INVALID', code: 'CSRF_INVALID' })
}
