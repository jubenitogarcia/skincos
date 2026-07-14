export function sanitizeProxyRequestHeaders(input: Headers): Headers {
  const headers = new Headers(input)
  headers.delete('host')
  headers.delete('content-length')
  headers.delete('content-encoding')
  headers.delete('transfer-encoding')
  headers.delete('connection')
  return headers
}

export function proxyRequestBody(method: string, request: Request): ReadableStream<Uint8Array> | null | undefined {
  const normalized = String(method || request.method || 'GET').toUpperCase()
  if (normalized === 'GET' || normalized === 'HEAD') return undefined
  return request.body
}

export function splitSetCookieHeader(headerValue: string): string[] {
  const raw = String(headerValue || '').trim()
  if (!raw) return []

  const out: string[] = []
  let start = 0
  let inExpires = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (!inExpires && (ch === 'e' || ch === 'E')) {
      const maybe = raw.slice(i, i + 8).toLowerCase()
      if (maybe === 'expires=') inExpires = true
    }
    if (inExpires && ch === ';') inExpires = false
    if (!inExpires && ch === ',') {
      const part = raw.slice(start, i).trim()
      if (part) out.push(part)
      start = i + 1
    }
  }

  const tail = raw.slice(start).trim()
  if (tail) out.push(tail)
  return out
}

export function copySetCookieHeaders(
  upstreamHeaders: Headers,
  outHeaders: Headers,
  rewriteCookie?: (cookie: string) => string
): void {
  const applyRewrite = (cookie: string) => (rewriteCookie ? rewriteCookie(cookie) : cookie)
  const getSetCookieMethod = (upstreamHeaders as any).getSetCookie?.bind?.(upstreamHeaders)
  const applyCookies = (cookies: string[]) => {
    if (!Array.isArray(cookies) || !cookies.length) return
    outHeaders.delete('set-cookie')
    for (const c of cookies) outHeaders.append('Set-Cookie', applyRewrite(c))
  }

  if (typeof getSetCookieMethod === 'function') {
    const cookies = getSetCookieMethod() as string[]
    applyCookies(cookies)
    return
  }

  const single = upstreamHeaders.get('set-cookie')
  if (single) applyCookies(splitSetCookieHeader(single))
}
