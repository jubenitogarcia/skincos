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
 * A pure compatibility map for planning/tests only. It is deliberately not
 * installed as a redirect: the old CRM origin is owned by the independent CRM
 * repository and this source-only package has no active Ponto publisher.
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
