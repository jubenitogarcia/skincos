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

async function importHmacKey(secret: string) {
  return crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signState(payload: Record<string, any>, secret: string) {
  const payloadJson = JSON.stringify(payload)
  const payloadB64 = base64UrlEncode(textEncoder.encode(payloadJson))
  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payloadB64))
  const sigB64 = base64UrlEncode(new Uint8Array(sig))
  return `${payloadB64}.${sigB64}`
}

export async function verifyState<T = any>(token: string, secret: string): Promise<T | null> {
  const [payloadB64, sigB64] = String(token || '').split('.')
  if (!payloadB64 || !sigB64) return null
  const key = await importHmacKey(secret)
  const ok = await crypto.subtle.verify('HMAC', key, base64UrlDecodeBytes(sigB64), textEncoder.encode(payloadB64))
  if (!ok) return null
  const payloadJson = new TextDecoder().decode(base64UrlDecodeBytes(payloadB64))
  return JSON.parse(payloadJson) as T
}

