import { decryptTokenIfNeeded, encryptTokenIfNeeded } from './tokenCrypto'
import { getJson, putJson } from './r2'
import { socialAccountKey } from './socialKeys'
import type { SocialAccountConfig, SocialPlatform } from './socialTypes'

export async function upsertSocialAccount(
  bucket: R2Bucket,
  input: Omit<SocialAccountConfig, 'updatedAt'>,
  secret?: string,
) {
  const updatedAt = new Date().toISOString()
  const accessToken = await encryptTokenIfNeeded(input.accessToken, secret)
  const out: SocialAccountConfig = { ...input, accessToken, updatedAt }
  await putJson(bucket, socialAccountKey(input.unitKey, input.platform), out)
  return { ...out, accessToken: input.accessToken }
}

export async function readSocialAccount(bucket: R2Bucket, unitKey: string, platform: SocialPlatform, secret?: string) {
  const cfg = await getJson<SocialAccountConfig>(bucket, socialAccountKey(unitKey, platform))
  if (!cfg) return null
  const accessToken = await decryptTokenIfNeeded(cfg.accessToken, secret)
  return { ...cfg, accessToken }
}

export async function deleteSocialAccount(bucket: R2Bucket, unitKey: string, platform: SocialPlatform) {
  await bucket.delete(socialAccountKey(unitKey, platform))
}

export async function listSocialAccounts(bucket: R2Bucket) {
  const accounts: Array<Omit<SocialAccountConfig, 'accessToken'> & { accessToken?: never }> = []
  let cursor: string | undefined = undefined
  for (;;) {
    const res = await bucket.list({ prefix: 'internal/social/accounts/', cursor })
    for (const o of res.objects || []) {
      const parts = String(o.key).split('/')
      // internal/social/accounts/<unitKey>/<platform>.json
      if (parts.length < 5) continue
      const unitKey = decodeURIComponent(parts[3] || '')
      const platformRaw = String(parts[4] || '').replace(/\.json$/, '')
      if (!unitKey || !platformRaw) continue
      const cfg = await getJson<SocialAccountConfig>(bucket, o.key).catch(() => null)
      if (!cfg) continue
      const { accessToken: _omit, ...rest } = cfg
      accounts.push(rest as any)
    }
    if (!res.truncated) break
    cursor = res.cursor
    if (!cursor) break
  }
  accounts.sort((a, b) => `${a.unitKey}:${a.platform}`.localeCompare(`${b.unitKey}:${b.platform}`))
  return accounts
}

