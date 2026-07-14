import { csrfHeader } from '@/csrf'

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
  const csrf = csrfHeader()
  Object.entries(csrf).forEach(([key, value]) => {
    if (value) headers.set(key, value)
  })
  return headers
}
