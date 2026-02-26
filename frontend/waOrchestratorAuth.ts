export function getCrmBasicAuthToken() {
  try {
    return String(window.localStorage.getItem('crm.basicAuth') || '').trim()
  } catch {
    return ''
  }
}

export function buildCrmBasicAuthHeaders(init?: HeadersInit) {
  const headers = new Headers(init || {})
  const token = getCrmBasicAuthToken()
  if (token) headers.set('Authorization', `Basic ${token}`)
  return headers
}
