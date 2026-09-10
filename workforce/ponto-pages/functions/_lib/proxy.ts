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
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (!inExpires && (char === 'e' || char === 'E') && raw.slice(index, index + 8).toLowerCase() === 'expires=') inExpires = true
    if (inExpires && char === ';') inExpires = false
    if (!inExpires && char === ',') {
      const part = raw.slice(start, index).trim()
      if (part) out.push(part)
      start = index + 1
    }
  }
  const tail = raw.slice(start).trim()
  if (tail) out.push(tail)
  return out
}

export function copySetCookieHeaders(
  upstreamHeaders: Headers,
  outHeaders: Headers,
  rewriteCookie?: (cookie: string) => string,
): void {
  const applyRewrite = (cookie: string) => rewriteCookie ? rewriteCookie(cookie) : cookie
  const getSetCookie = (upstreamHeaders as any).getSetCookie?.bind?.(upstreamHeaders)
  const apply = (cookies: string[]) => {
    if (!Array.isArray(cookies) || !cookies.length) return
    outHeaders.delete('set-cookie')
    for (const cookie of cookies) outHeaders.append('Set-Cookie', applyRewrite(cookie))
  }
  if (typeof getSetCookie === 'function') {
    apply(getSetCookie())
    return
  }
  const single = upstreamHeaders.get('set-cookie')
  if (single) apply(splitSetCookieHeader(single))
}
