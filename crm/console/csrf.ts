export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  try {
    const parts = String(document.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const p of parts) {
      const idx = p.indexOf('=')
      if (idx <= 0) continue
      const k = p.slice(0, idx).trim()
      const v = p.slice(idx + 1).trim()
      if (k === name) return v
    }
  } catch {
    // ignore
  }
  return null
}

export function getCsrfToken(): string | null {
  return getCookie('csrfToken')
}

export function csrfHeader(): Record<string, string> {
  const token = getCsrfToken()
  return token ? { 'x-csrf-token': token } : {}
}

