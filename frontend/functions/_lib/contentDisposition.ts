export function safeContentDispositionFilename(name: string, fallback = 'arquivo'): string {
  const raw = String(name || '').replace(/[\r\n"]/g, '').trim()
  const cleaned = raw
    .replace(/[^a-zA-Z0-9._ -]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s_-]+/, '')
    .trim()
  const limited = cleaned.slice(0, 150).trim()
  return limited || fallback
}

