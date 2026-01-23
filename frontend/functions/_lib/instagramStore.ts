import { getJson, putJson } from './r2'
import { decryptTokenIfNeeded, encryptTokenIfNeeded } from './tokenCrypto'

export type InstagramConnection = {
  accessToken: string
  igBusinessAccountId: string
  pageId?: string
  tokenType: 'manual' | 'oauth'
  updatedAt: string
}

export type InstagramPendingOAuth = {
  userId: string
  accessToken: string
  pages: Array<{ id: string; name?: string; instagram_business_account?: { id: string; username?: string } }>
  createdAt: string
}

export function connectionKey(userId: string) {
  return `internal/integrations/instagram/users/${userId}/connection.json`
}

export function pendingKey(userId: string, pendingId: string) {
  return `internal/integrations/instagram/users/${userId}/pending/${pendingId}.json`
}

export async function readConnectionDecrypted(bucket: R2Bucket, userId: string, secret?: string): Promise<InstagramConnection | null> {
  const data = await getJson<InstagramConnection>(bucket, connectionKey(userId))
  if (!data) return null
  const accessToken = await decryptTokenIfNeeded(data.accessToken, secret)
  return { ...data, accessToken }
}

export async function writeConnection(bucket: R2Bucket, userId: string, value: InstagramConnection, secret?: string) {
  const accessToken = await encryptTokenIfNeeded(value.accessToken, secret)
  await putJson(bucket, connectionKey(userId), { ...value, accessToken })
}

export async function deleteConnection(bucket: R2Bucket, userId: string) {
  await bucket.delete(connectionKey(userId))
}

export async function writePending(bucket: R2Bucket, userId: string, pendingId: string, value: InstagramPendingOAuth, secret?: string) {
  const accessToken = await encryptTokenIfNeeded(value.accessToken, secret)
  await putJson(bucket, pendingKey(userId, pendingId), { ...value, accessToken })
}

export async function readPendingDecrypted(bucket: R2Bucket, userId: string, pendingId: string, secret?: string): Promise<InstagramPendingOAuth | null> {
  const data = await getJson<InstagramPendingOAuth>(bucket, pendingKey(userId, pendingId))
  if (!data) return null
  const accessToken = await decryptTokenIfNeeded(data.accessToken, secret)
  return { ...data, accessToken }
}

export async function deletePending(bucket: R2Bucket, userId: string, pendingId: string) {
  await bucket.delete(pendingKey(userId, pendingId))
}

