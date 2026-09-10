export type PontoLegacyLocation = {
  pathname: string
  search?: string
  origin: string
}

function validDedicatedOrigin(value: string): URL | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    if (!url.hostname.endsWith('.skincos.com.br')) return null
    return url
  } catch {
    return null
  }
}

/**
 * A pure Phase 1 compatibility map. It is deliberately not installed as a
 * redirect: old URLs continue to be served by the existing Pages project.
 */
export function resolvePontoLegacyHandoff(location: PontoLegacyLocation, dedicatedOrigin: string): string | null {
  if (String(location.origin || '').replace(/\/$/, '') !== 'https://crm.skincos.com.br') return null
  const target = validDedicatedOrigin(dedicatedOrigin)
  if (!target) return null
  const pathname = String(location.pathname || '/')
  const query = new URLSearchParams(String(location.search || '').replace(/^\?/, ''))
  if ((pathname === '/' || pathname === '') && query.get('module') === 'ponto') return `${target.origin}/`
  if (pathname === '/ponto-terminal' || pathname === '/ponto-terminal.html') return `${target.origin}/ponto-terminal.html`
  return null
}
