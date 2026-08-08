/**
 * Browser-only routing contract for the Clientes workspace.
 *
 * This deliberately does not depend on a general-purpose router: Clientes is
 * still a lazily loaded CRM module and the URL must never grant access by
 * itself. App.tsx and the API continue to enforce the module/role boundary.
 */
export type ClientesWorkspaceView = 'overview' | 'wallet' | 'actions' | 'identities' | 'quality' | 'governance'

export type ClientesWorkspaceRoute = {
  view: ClientesWorkspaceView
  identityId?: string
  source: 'path' | 'legacy'
}

export type ClientesWalletSort = 'priority' | 'recency' | 'lifetime_sales' | 'visits' | 'sales' | 'last_attendance' | 'name'
export type ClientesWalletDirection = 'asc' | 'desc'

export type ClientesWalletUrlState = {
  unit: string
  segment: string
  priority: string
  q: string
  sort: ClientesWalletSort
  direction: ClientesWalletDirection
  offset: number
}

export const clientesWorkspaceViews: ReadonlyArray<{ key: ClientesWorkspaceView; slug: string; label: string; description: string }> = [
  { key: 'overview', slug: 'visao-geral', label: 'Visão geral', description: 'Resumo e prioridades consolidadas' },
  { key: 'wallet', slug: 'carteira', label: 'Carteira', description: 'Clientes e contexto individual' },
  { key: 'actions', slug: 'acoes', label: 'Ações', description: 'Fila comercial assistida' },
  { key: 'identities', slug: 'identidades', label: 'Identidades', description: 'Revisões e linhagem' },
  { key: 'quality', slug: 'qualidade', label: 'Qualidade', description: 'SLA e controles operacionais' },
  { key: 'governance', slug: 'governanca', label: 'Governança', description: 'Políticas e cadências' },
] as const

const routeBySlug = new Map(clientesWorkspaceViews.map((route) => [route.slug, route]))
const routeByKey = new Map(clientesWorkspaceViews.map((route) => [route.key, route]))
const walletSorts = new Set<ClientesWalletSort>(['priority', 'recency', 'lifetime_sales', 'visits', 'sales', 'last_attendance', 'name'])
const walletDirections = new Set<ClientesWalletDirection>(['asc', 'desc'])
const walletPriorities = new Set(['', 'high', 'medium', 'normal'])
const walletSegments = new Set(['', 'return_at_risk', 'high_value_inactive', 'frequent', 'balanced_vip', 'first_return', 'reactivation_potential'])
const identityIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export const defaultClientesWalletUrlState: ClientesWalletUrlState = {
  unit: 'all',
  segment: '',
  priority: '',
  q: '',
  sort: 'priority',
  direction: 'desc',
  offset: 0,
}

/** Query keys owned by Clientes and safe to remove when leaving the workspace. */
export const clientesWorkspaceQueryKeys = ['module', 'tab', 'clientesView', 'identityId', 'unit', 'segment', 'priority', 'q', 'sort', 'direction', 'offset'] as const

function asUrl(input?: URL | Location | string) {
  if (input instanceof URL) return new URL(input.toString())
  if (typeof input === 'string') return new URL(input, 'https://crm.invalid')
  if (input) return new URL(input.href)
  if (typeof window !== 'undefined') return new URL(window.location.href)
  return new URL('https://crm.invalid/')
}

function boundedText(value: string | null, maxLength: number) {
  return String(value || '').trim().slice(0, maxLength)
}

function safeOffset(value: string | null) {
  if (!value || !/^\d{1,7}$/.test(value)) return 0
  return Math.min(1_000_000, Number(value))
}

function normaliseClientesWalletUrlState(input: Partial<ClientesWalletUrlState>): ClientesWalletUrlState {
  const unit = boundedText(typeof input.unit === 'string' ? input.unit : null, 80)
  const segment = boundedText(typeof input.segment === 'string' ? input.segment : null, 80)
  const priority = boundedText(typeof input.priority === 'string' ? input.priority : null, 20)
  const q = boundedText(typeof input.q === 'string' ? input.q : null, 96)
  const sort = boundedText(typeof input.sort === 'string' ? input.sort : null, 32) as ClientesWalletSort
  const direction = boundedText(typeof input.direction === 'string' ? input.direction : null, 8) as ClientesWalletDirection
  const offset = Number.isSafeInteger(input.offset) && Number(input.offset) >= 0
    ? Math.min(1_000_000, Number(input.offset))
    : 0
  return {
    unit: unit || 'all',
    segment: walletSegments.has(segment) ? segment : '',
    priority: walletPriorities.has(priority) ? priority : '',
    q,
    sort: walletSorts.has(sort) ? sort : defaultClientesWalletUrlState.sort,
    direction: walletDirections.has(direction) ? direction : defaultClientesWalletUrlState.direction,
    offset,
  }
}

function legacyView(value: string | null): ClientesWorkspaceView {
  return routeByKey.has(value as ClientesWorkspaceView) ? value as ClientesWorkspaceView : 'overview'
}

/** Returns null when the URL does not belong to Clientes. */
export function parseClientesWorkspaceRoute(input?: URL | Location | string): ClientesWorkspaceRoute | null {
  const url = asUrl(input)
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  if (pathname === '/clientes') return { view: 'overview', source: 'path' }
  if (pathname.startsWith('/clientes/')) {
    const segments = pathname.slice('/clientes/'.length).split('/').filter(Boolean)
    if (segments.length === 1) {
      const route = routeBySlug.get(segments[0])
      return route ? { view: route.key, source: 'path' } : null
    }
    if (segments.length === 2 && segments[0] === 'cliente') {
      let identityId = ''
      try {
        identityId = decodeURIComponent(segments[1])
      } catch {
        return null
      }
      if (!identityIdPattern.test(identityId)) return null
      return { view: 'wallet', identityId, source: 'path' }
    }
    return null
  }

  const module = url.searchParams.get('module') || url.searchParams.get('tab')
  if (module !== 'clientes') return null
  const identityId = boundedText(url.searchParams.get('identityId'), 128)
  return identityIdPattern.test(identityId)
    ? { view: 'wallet', identityId, source: 'legacy' }
    : { view: legacyView(url.searchParams.get('clientesView')), source: 'legacy' }
}

export function clientesWorkspacePath(route: Pick<ClientesWorkspaceRoute, 'view' | 'identityId'>) {
  if (route.identityId && identityIdPattern.test(route.identityId)) return `/clientes/cliente/${encodeURIComponent(route.identityId)}`
  return `/clientes/${routeByKey.get(route.view)?.slug || 'visao-geral'}`
}

/**
 * Reads only allowlisted, bounded values. It is safe to pass this directly to
 * the server-side cartera query; unknown query parameters are intentionally
 * ignored instead of being forwarded to the API.
 */
export function readClientesWalletUrlState(input?: URL | Location | string): ClientesWalletUrlState {
  const params = asUrl(input).searchParams
  // A search query is only ever sent to the server after an explicit user
  // action. It is never copied into logs or application telemetry here.
  return normaliseClientesWalletUrlState({
    unit: params.get('unit') || '',
    segment: params.get('segment') || '',
    priority: params.get('priority') || '',
    q: params.get('q') || '',
    sort: params.get('sort') as ClientesWalletSort,
    direction: params.get('direction') as ClientesWalletDirection,
    offset: safeOffset(params.get('offset')),
  })
}

export function clientesWorkspaceUrl(
  route: Pick<ClientesWorkspaceRoute, 'view' | 'identityId'>,
  filters: Partial<ClientesWalletUrlState> = {},
  input?: URL | Location | string,
) {
  const url = asUrl(input)
  const state = normaliseClientesWalletUrlState({ ...defaultClientesWalletUrlState, ...filters })
  url.pathname = clientesWorkspacePath(route)
  for (const key of clientesWorkspaceQueryKeys) {
    url.searchParams.delete(key)
  }
  if (state.unit && state.unit !== 'all') url.searchParams.set('unit', state.unit)
  if (state.segment) url.searchParams.set('segment', state.segment)
  if (state.priority) url.searchParams.set('priority', state.priority)
  if (state.q) url.searchParams.set('q', state.q)
  if (state.sort !== defaultClientesWalletUrlState.sort) url.searchParams.set('sort', state.sort)
  if (state.direction !== defaultClientesWalletUrlState.direction) url.searchParams.set('direction', state.direction)
  if (state.offset > 0) url.searchParams.set('offset', String(state.offset))
  return `${url.pathname}${url.search}${url.hash}`
}

/** True for canonical Clientes paths, before any role or module gate is applied. */
export function isClientesWorkspacePath(input?: URL | Location | string) {
  const url = asUrl(input)
  return url.pathname === '/clientes' || url.pathname.startsWith('/clientes/')
}
