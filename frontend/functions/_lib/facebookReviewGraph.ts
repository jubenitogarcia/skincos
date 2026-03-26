const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

type GraphError = { error?: { message?: string } }

const filterBody = (input: Record<string, any>) =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ''))

export async function facebookReviewGraphGet<T>(path: string, params: Record<string, any>, accessToken: string): Promise<T> {
  const qs = new URLSearchParams({
    ...filterBody(params),
    access_token: accessToken,
  })
  const url = `${GRAPH_BASE}/${path}?${qs.toString()}`
  const res = await fetch(url)
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error((json as GraphError)?.error?.message || `Graph API error (HTTP ${res.status})`)
  return json as T
}

export async function facebookReviewGraphPost<T>(path: string, body: Record<string, any>, accessToken: string): Promise<T> {
  const form = new URLSearchParams({
    ...filterBody(body),
    access_token: accessToken,
  })
  const res = await fetch(`${GRAPH_BASE}/${path}`, { method: 'POST', body: form })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error((json as GraphError)?.error?.message || `Graph API error (HTTP ${res.status})`)
  return json as T
}

export async function facebookReviewGraphDelete<T>(path: string, accessToken: string): Promise<T> {
  const qs = new URLSearchParams({ access_token: accessToken })
  const res = await fetch(`${GRAPH_BASE}/${path}?${qs.toString()}`, { method: 'DELETE' })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error((json as GraphError)?.error?.message || `Graph API error (HTTP ${res.status})`)
  return json as T
}
