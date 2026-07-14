const BRT_OFFSET_MS = 3 * 60 * 60 * 1000

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

export function dateKeyFromMsBrt(ms = Date.now()): string {
  const d = new Date(ms - BRT_OFFSET_MS)
  const dd = pad(d.getUTCDate())
  const mm = pad(d.getUTCMonth() + 1)
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${dd}${mm}${yy}`
}

export function groupKeyFromMsBrt(ms = Date.now()): string {
  const d = new Date(ms - BRT_OFFSET_MS)
  const dd = pad(d.getUTCDate())
  const mm = pad(d.getUTCMonth() + 1)
  const yy = String(d.getUTCFullYear()).slice(-2)
  const HH = pad(d.getUTCHours())
  const Min = pad(d.getUTCMinutes())
  return `${dd}${mm}${yy}${HH}${Min}`
}

export function groupKeyFromFilename(name: string): string | null {
  const base = String(name || '').split('.')[0] || ''
  const m = base.match(/^(\d{10})/)
  return m ? m[1] : null
}

export function dateKeyFromGroupKey(groupKey: string): string | null {
  const m = String(groupKey || '').match(/^(\d{6})\d{4}$/)
  return m ? m[1] : null
}

export function scheduledAtFromGroupKeyBrt(groupKey: string): string | null {
  const m = String(groupKey || '').match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  if (!m) return null
  const [, dd, mm, yy, HH, Min] = m
  const yyyy = `20${yy}`
  return `${yyyy}-${mm}-${dd}T${HH}:${Min}:00-03:00`
}

export function normalizeIsoOrThrow(value: string): string {
  const iso = String(value || '').trim()
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) throw new Error('scheduledAt inválido (ISO esperado).')
  return new Date(ms).toISOString()
}

