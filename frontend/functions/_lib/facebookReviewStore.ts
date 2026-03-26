import { getJson, putJson } from './r2'
import { decryptTokenIfNeeded, encryptTokenIfNeeded } from './tokenCrypto'

export type FacebookReviewPage = {
  id: string
  name?: string
  accessToken?: string
  pictureUrl?: string
  tasks?: string[]
}

export type FacebookReviewConnection = {
  userAccessToken: string
  pageId?: string
  pageName?: string
  pageAccessToken?: string
  tokenType: 'oauth'
  updatedAt: string
}

export type FacebookReviewPendingOAuth = {
  userId: string
  userAccessToken: string
  pages: FacebookReviewPage[]
  createdAt: string
}

const encryptPageIfNeeded = async (page: FacebookReviewPage, secret?: string): Promise<FacebookReviewPage> => ({
  ...page,
  accessToken: page.accessToken ? await encryptTokenIfNeeded(page.accessToken, secret) : undefined,
})

const decryptPageIfNeeded = async (page: FacebookReviewPage, secret?: string): Promise<FacebookReviewPage> => ({
  ...page,
  accessToken: page.accessToken ? await decryptTokenIfNeeded(page.accessToken, secret) : undefined,
})

export function facebookReviewConnectionKey(userId: string) {
  return `internal/integrations/facebook-review/users/${userId}/connection.json`
}

export function facebookReviewPendingKey(userId: string, pendingId: string) {
  return `internal/integrations/facebook-review/users/${userId}/pending/${pendingId}.json`
}

export async function readFacebookReviewConnectionDecrypted(
  bucket: R2Bucket,
  userId: string,
  secret?: string,
): Promise<FacebookReviewConnection | null> {
  const data = await getJson<FacebookReviewConnection>(bucket, facebookReviewConnectionKey(userId))
  if (!data) return null
  return {
    ...data,
    userAccessToken: await decryptTokenIfNeeded(data.userAccessToken, secret),
    pageAccessToken: data.pageAccessToken ? await decryptTokenIfNeeded(data.pageAccessToken, secret) : undefined,
  }
}

export async function writeFacebookReviewConnection(
  bucket: R2Bucket,
  userId: string,
  value: FacebookReviewConnection,
  secret?: string,
) {
  await putJson(bucket, facebookReviewConnectionKey(userId), {
    ...value,
    userAccessToken: await encryptTokenIfNeeded(value.userAccessToken, secret),
    pageAccessToken: value.pageAccessToken ? await encryptTokenIfNeeded(value.pageAccessToken, secret) : undefined,
  })
}

export async function deleteFacebookReviewConnection(bucket: R2Bucket, userId: string) {
  await bucket.delete(facebookReviewConnectionKey(userId))
}

export async function writeFacebookReviewPending(
  bucket: R2Bucket,
  userId: string,
  pendingId: string,
  value: FacebookReviewPendingOAuth,
  secret?: string,
) {
  const pages: FacebookReviewPage[] = []
  for (const page of value.pages || []) pages.push(await encryptPageIfNeeded(page, secret))
  await putJson(bucket, facebookReviewPendingKey(userId, pendingId), {
    ...value,
    userAccessToken: await encryptTokenIfNeeded(value.userAccessToken, secret),
    pages,
  })
}

export async function readFacebookReviewPendingDecrypted(
  bucket: R2Bucket,
  userId: string,
  pendingId: string,
  secret?: string,
): Promise<FacebookReviewPendingOAuth | null> {
  const data = await getJson<FacebookReviewPendingOAuth>(bucket, facebookReviewPendingKey(userId, pendingId))
  if (!data) return null
  const pages: FacebookReviewPage[] = []
  for (const page of data.pages || []) pages.push(await decryptPageIfNeeded(page, secret))
  return {
    ...data,
    userAccessToken: await decryptTokenIfNeeded(data.userAccessToken, secret),
    pages,
  }
}

export async function deleteFacebookReviewPending(bucket: R2Bucket, userId: string, pendingId: string) {
  await bucket.delete(facebookReviewPendingKey(userId, pendingId))
}
