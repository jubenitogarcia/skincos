const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

function parseCookies(cookieHeader = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of String(cookieHeader || '').split(';')) {
    const s = part.trim()
    if (!s) continue
    const idx = s.indexOf('=')
    if (idx <= 0) continue
    const k = s.slice(0, idx).trim()
    const v = s.slice(idx + 1).trim()
    if (!k) continue
    out[k] = v
  }
  return out
}

function originGuard(request: Request): Response | null {
  const origin = request.headers.get('origin')
  if (!origin) return null
  try {
    const expected = new URL(request.url).origin
    if (origin !== expected) {
      return json(403, { ok: false, error: 'FORBIDDEN', code: 'ORIGIN_INVALID' })
    }
  } catch {
    return json(403, { ok: false, error: 'FORBIDDEN', code: 'ORIGIN_INVALID' })
  }
  return null
}

export function requireSameOrigin(context: any): Response | null {
  const request: Request | undefined = context?.request
  if (!request) return json(500, { ok: false, error: 'INTERNAL_ERROR', code: 'REQUEST_MISSING' })
  return originGuard(request)
}

export function requireCsrfForMutations(context: any): Response | null {
  const request: Request | undefined = context?.request
  if (!request) return json(500, { ok: false, error: 'INTERNAL_ERROR', code: 'REQUEST_MISSING' })

  const method = String(request.method || 'GET').toUpperCase()
  const isMutating = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
  if (!isMutating) return null

  const originRes = originGuard(request)
  if (originRes) return originRes

  const cookies = parseCookies(request.headers.get('cookie') || '')
  const csrfCookie = String(cookies.csrfToken || '').trim()
  const csrfHeader = String(request.headers.get('x-csrf-token') || request.headers.get('X-CSRF-Token') || '').trim()

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return json(403, { ok: false, error: 'CSRF_INVALID', code: 'CSRF_INVALID' })
  }

  return null
}
