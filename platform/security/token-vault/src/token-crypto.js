function safeString(value) {
  return String(value ?? '').trim();
}

export async function encryptToken(token, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(token);
  const key = await getEncryptionKey(env);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return `v1:${base64Encode(iv)}:${base64Encode(new Uint8Array(ciphertext))}`;
}

export async function decryptToken(value, env) {
  const parts = safeString(value).split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('unsupported_ciphertext');
  }
  const iv = base64Decode(parts[1]);
  const ciphertext = base64Decode(parts[2]);
  const key = await getEncryptionKey(env);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

async function getEncryptionKey(env) {
  const secret = safeString(env.TOKEN_VAULT_ENCRYPTION_KEY);
  if (secret.length < 32) throw new Error('TOKEN_VAULT_ENCRYPTION_KEY must be configured');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function base64Encode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
