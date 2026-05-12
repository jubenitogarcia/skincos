import { getJson, putJson } from './r2'
import { decryptTokenIfNeeded, encryptTokenIfNeeded } from './tokenCrypto'

export type MetaAdsConnection = {
  accessToken: string
  tokenType: 'manual' | 'oauth'
  metaUserId?: string
  metaUserName?: string
  scopes?: string[]
  expiresAt?: string
  selectedAdAccountId?: string
  updatedAt: string
}

export function connectionKey(userId: string) {
  return `internal/integrations/meta-ads/users/${userId}/connection.json`
}

export async function readMetaAdsConnectionDecrypted(
  bucket: R2Bucket,
  userId: string,
  secret?: string,
): Promise<MetaAdsConnection | null> {
  const data = await getJson<MetaAdsConnection>(bucket, connectionKey(userId))
  if (!data) return null
  const accessToken = await decryptTokenIfNeeded(data.accessToken, secret)
  return { ...data, accessToken }
}

export async function writeMetaAdsConnection(
  bucket: R2Bucket,
  userId: string,
  value: MetaAdsConnection,
  secret?: string,
) {
  const accessToken = await encryptTokenIfNeeded(value.accessToken, secret)
  await putJson(bucket, connectionKey(userId), { ...value, accessToken })
}

export async function deleteMetaAdsConnection(bucket: R2Bucket, userId: string) {
  await bucket.delete(connectionKey(userId))
}
