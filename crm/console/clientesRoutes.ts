export const CLIENTES_BASE_PATH = '/clientes'

export const CLIENTES_WORKSPACE_VIEWS = [
  'overview',
  'wallet',
  'actions',
  'identities',
  'quality',
  'governance',
] as const

export type ClientesWorkspaceView = (typeof CLIENTES_WORKSPACE_VIEWS)[number]

export type ClientesRoute = {
  view: ClientesWorkspaceView
  identityId: string | null
}

export type ClientesWalletFilters = {
  unit?: string
  segment?: string
  priority?: string
  q?: string
  page?: number
  pageSize?: number
  sort?: string
  direction?: 'asc' | 'desc'
  assigned?: 'none' | 'any'
  sla?: 'overdue'
  permission?: 'expiring'
  review?: 'pending'
  stale?: 'stale'
  columns?: string
  view?: string
}

const VIEW_BY_SEGMENT: Record<string, ClientesWorkspaceView> = {
  'visao-geral': 'overview',
  carteira: 'wallet',
  acoes: 'actions',
  identidades: 'identities',
  qualidade: 'quality',
  governanca: 'governance',
}

const SEGMENT_BY_VIEW: Record<ClientesWorkspaceView, string> = {
  overview: 'visao-geral',
  wallet: 'carteira',
  actions: 'acoes',
  identities: 'identidades',
  quality: 'qualidade',
  governance: 'governanca',
}

const FILTER_KEYS = [
  'unit', 'segment', 'priority', 'q', 'page', 'pageSize', 'sort', 'direction',
  'assigned', 'sla', 'permission', 'review', 'stale', 'columns', 'view',
] as const

const IDENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function isClientesPath(pathname: string) {
  const value = String(pathname || '')
  return value === CLIENTES_BASE_PATH || value.startsWith(`${CLIENTES_BASE_PATH}/`)
}

function validView(value: string | null | undefined): ClientesWorkspaceView | null {
  return value && Object.prototype.hasOwnProperty.call(VIEW_BY_SEGMENT, value) ? VIEW_BY_SEGMENT[value] : null
}

function safeIdentityId(value: string | null | undefined) {
  const decoded = String(value || '').trim()
  return IDENTITY_ID_PATTERN.test(decoded) ? decoded : null
}

export function parseClientesLocation(location: Pick<Location, 'pathname' | 'search'>): ClientesRoute & { filters: ClientesWalletFilters } {
  const path = String(location.pathname || '')
  const parts = path.split('/').filter(Boolean)
  let view: ClientesWorkspaceView = 'overview'
  let identityId: string | null = null

  if (parts[0] === 'clientes') {
    if (parts[1] === 'cliente') {
      let decodedIdentityId = ''
      try {
        decodedIdentityId = decodeURIComponent(parts[2] || '')
      } catch {
        decodedIdentityId = ''
      }
      identityId = safeIdentityId(decodedIdentityId)
      if (identityId) view = 'wallet'
    } else {
      view = validView(parts[1]) || 'overview'
    }
  }

  const params = new URLSearchParams(location.search || '')
  // `clientesView` is retained as a read-only compatibility bridge for links
  // created before the real pathname contract existed.
  if (parts.length <= 1) view = validView(params.get('clientesView')) || view
  const filters = FILTER_KEYS.reduce<ClientesWalletFilters>((result, key) => {
    const value = params.get(key)
    if (value !== null && value !== '') {
      if (key === 'page' || key === 'pageSize') {
        const parsed = Number(value)
        if (Number.isInteger(parsed) && parsed >= 0) result[key] = parsed
      } else if (key === 'direction') {
        if (value === 'asc' || value === 'desc') result.direction = value
      } else if (key === 'assigned' && (value === 'none' || value === 'any')) {
        result.assigned = value
      } else if (key === 'sla' && value === 'overdue') {
        result.sla = value
      } else if (key === 'permission' && value === 'expiring') {
        result.permission = value
      } else if (key === 'review' && value === 'pending') {
        result.review = value
      } else if (key === 'stale' && value === 'stale') {
        result.stale = value
      } else {
        if (key === 'unit') result.unit = value
        else if (key === 'segment') result.segment = value
        else if (key === 'priority') result.priority = value
        else if (key === 'q') result.q = value
        else if (key === 'sort') result.sort = value
        else if (key === 'columns') result.columns = value
        else if (key === 'view') result.view = value
      }
    }
    return result
  }, {})

  return { view, identityId, filters }
}

export function buildClientesPath(view: ClientesWorkspaceView, filters: ClientesWalletFilters = {}, identityId?: string | null) {
  const path = identityId ? `${CLIENTES_BASE_PATH}/cliente/${encodeURIComponent(identityId)}` : `${CLIENTES_BASE_PATH}/${SEGMENT_BY_VIEW[view]}`
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const value = filters[key]
    if (value !== undefined && value !== null && value !== '' && !(key === 'page' && Number(value) === 0)) {
      params.set(key, String(value))
    }
  }
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

export function clientesFilterParams(filters: ClientesWalletFilters) {
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const value = filters[key]
    if (value !== undefined && value !== null && value !== '' && value !== 'all') params.set(key, String(value))
  }
  return params
}

export function clientesFiltersFromSearch(search: string) {
  return parseClientesLocation({ pathname: `${CLIENTES_BASE_PATH}/carteira`, search }).filters
}
