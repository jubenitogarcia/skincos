function sanitizeColor(input: unknown, fallback: string) {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return fallback
  const hex = raw.startsWith('#') ? raw.slice(1) : raw
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(hex)) return fallback
  return `#${hex.toLowerCase()}`
}

function escapeXml(input: unknown) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)

  const wRaw = Number.parseInt(String(context.params?.w || ''), 10)
  const hRaw = Number.parseInt(String(context.params?.h || ''), 10)
  const w = Number.isFinite(wRaw) ? Math.max(1, Math.min(2048, wRaw)) : 400
  const h = Number.isFinite(hRaw) ? Math.max(1, Math.min(2048, hRaw)) : 400

  const bg = sanitizeColor(url.searchParams.get('bg'), '#111827')
  const fg = sanitizeColor(url.searchParams.get('fg'), '#93c5fd')
  const textParam = url.searchParams.get('text')
  const text = textParam && textParam.trim() ? textParam.trim().slice(0, 80) : `${w}×${h}`

  const fontSize = Math.max(12, Math.min(28, Math.floor(Math.min(w, h) / 10)))
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(text)}">` +
    `<rect width="100%" height="100%" fill="${bg}"/>` +
    `<g fill="${fg}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" font-size="${fontSize}">` +
    `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle">${escapeXml(text)}</text>` +
    `</g>` +
    `</svg>`

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=86400, immutable',
    },
  })
}

