const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

type GraphError = { error?: { message?: string } }

export async function graphGet<T>(path: string, params: Record<string, any>, accessToken: string): Promise<T> {
  const qs = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null)),
    access_token: accessToken,
  })
  const url = `${GRAPH_BASE}/${path}?${qs.toString()}`
  const res = await fetch(url)
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error((json as GraphError)?.error?.message || `Graph API error (HTTP ${res.status})`)
  return json as T
}

export async function graphPost<T>(path: string, body: Record<string, any>, accessToken: string): Promise<T> {
  const form = new URLSearchParams({
    ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== null)),
    access_token: accessToken,
  })
  const res = await fetch(`${GRAPH_BASE}/${path}`, { method: 'POST', body: form })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error((json as GraphError)?.error?.message || `Graph API error (HTTP ${res.status})`)
  return json as T
}

