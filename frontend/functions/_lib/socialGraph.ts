type GraphError = { error?: { message?: string } }

const normalizeParams = (params: Record<string, any>) =>
  Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null))

const formValue = (v: any) => {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

export async function graphGet<T>(base: string, path: string, params: Record<string, any>, accessToken: string): Promise<T> {
  const qs = new URLSearchParams({ ...normalizeParams(params), access_token: accessToken } as any)
  const url = `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}?${qs.toString()}`
  const res = await fetch(url)
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error((json as GraphError)?.error?.message || `Graph API error (HTTP ${res.status})`)
  return json as T
}

export async function graphPost<T>(base: string, path: string, body: Record<string, any>, accessToken: string): Promise<T> {
  const form = new FormData()
  for (const [k, v] of Object.entries(normalizeParams(body))) form.set(k, formValue(v))
  form.set('access_token', accessToken)
  const url = `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
  const res = await fetch(url, { method: 'POST', body: form })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error((json as GraphError)?.error?.message || `Graph API error (HTTP ${res.status})`)
  return json as T
}

