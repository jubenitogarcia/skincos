const textEncoder = new TextEncoder()

const base64UrlEncode = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const base64UrlDecodeBytes = (s: string) => {
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '==='.slice((base64.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveKey(secret: string) {
  const hash = await crypto.subtle.digest('SHA-256', textEncoder.encode(secret))
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptTokenIfNeeded(token: string, secret?: string) {
  if (!secret) return token
  if (token.startsWith('enc:')) return token
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(secret)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(token))
  const out = `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ct))}`
  return `enc:${out}`
}

export async function decryptTokenIfNeeded(token: string, secret?: string) {
  if (!token.startsWith('enc:')) return token
  if (!secret) throw new Error('Encrypted token but INTEGRATIONS_ENCRYPTION_SECRET not configured')
  const raw = token.slice('enc:'.length)
  const [ivB64, ctB64] = raw.split('.')
  if (!ivB64 || !ctB64) throw new Error('Invalid encrypted token')
  const iv = base64UrlDecodeBytes(ivB64)
  const ct = base64UrlDecodeBytes(ctB64)
  const key = await deriveKey(secret)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(new Uint8Array(pt))
}

