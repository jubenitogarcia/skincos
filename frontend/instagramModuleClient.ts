type ApiErrorShape =
  | { error?: string; message?: string }
  | { success?: boolean; error?: string; message?: string }

function asErrorMessage(e: unknown) {
  if (e instanceof Error) return e.message
  return String(e || 'Erro desconhecido')
}

async function readJsonOrText(res: Response) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return text || null
  }
}

async function api<T>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const authToken =
    typeof window !== 'undefined'
      ? (() => {
          try {
            return localStorage.getItem('instagram-module-auth-token') || ''
          } catch {
            return ''
          }
        })()
      : ''

  const headers: Record<string, string> = opts.body
    ? { 'content-type': 'application/json', accept: 'application/json' }
    : { accept: 'application/json' }
  if (authToken) {
    headers.authorization = authToken.toLowerCase().startsWith('bearer ') ? authToken : `Bearer ${authToken}`
  }

  const res = await fetch(`/api/instagram-module${path.startsWith('/') ? '' : '/'}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
  })
  const payload = await readJsonOrText(res)
  if (res.ok) return payload as T
  const err = payload as ApiErrorShape
  throw new Error((err as any)?.error || (err as any)?.message || `HTTP ${res.status}`)
}

export type InstagramModuleHealth = {
  status?: string
  mode?: string
  accounts_configured?: number
  active_sessions?: number
  config_loaded?: boolean
  timestamp?: string
  dependencies?: Record<string, any>
}

export type InstagramModuleAccount = {
  account_id: string
  username: string
  session_file?: string
  added_at?: string
  status?: string
  is_active?: boolean
}

export type InstagramModuleAccountsResponse = {
  success?: boolean
  accounts?: InstagramModuleAccount[]
  total?: number
}

export type InstagramModuleAnalyticsResponse = {
  success?: boolean
  analytics?: any
}

export async function instagramModuleHealth() {
  return api<InstagramModuleHealth>('/health')
}

export async function instagramModuleListAccounts() {
  const out = await api<InstagramModuleAccountsResponse>('/api/accounts')
  return out.accounts || []
}

export async function instagramModuleAddAccount(input: { username: string; password: string; account_id?: string }) {
  try {
    return await api<{ success?: boolean; account_id?: string; message?: string }>('/api/accounts', {
      method: 'POST',
      body: input,
    })
  } catch (e) {
    throw new Error(asErrorMessage(e))
  }
}

export async function instagramModuleGetAnalytics(accountId: string) {
  const out = await api<InstagramModuleAnalyticsResponse>(`/api/accounts/${encodeURIComponent(accountId)}/analytics`)
  return out.analytics
}

export async function instagramModuleOsintInvestigate(input: { username: string; deep_analysis?: boolean }) {
  return api<any>('/api/osint/investigate', { method: 'POST', body: input })
}

export async function instagramModuleDownloadContent(input: { username: string; content_types?: string[]; max_items?: number }) {
  return api<any>('/api/download', { method: 'POST', body: input })
}

export async function instagramModuleRunAutomation(input: {
  account_id: string
  target_hashtags?: string[]
  max_likes?: number
  max_follows?: number
}) {
  return api<any>('/api/automation', { method: 'POST', body: input })
}
